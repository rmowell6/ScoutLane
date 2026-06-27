// Packet pipeline orchestrator (Engineering Plan §5). Sequences the individually-tested steps,
// runs the deterministic guardrails, then generates the .docx packet. The /api/packet route
// that calls this sets runtime='nodejs' (docx Packer + Supabase upload need Node).
import { structureResume } from './structureResume'
import { parseJob } from './parseJob'
import { scoreFit } from './scoreFit'
import { tailorResume } from './tailorResume'
import { runGuardrails, type GuardrailReport } from '@/lib/guardrails'
import { BANNED_TERMS, STYLE_RULES } from '@/lib/profileRules'
import { buildResumeDocx } from '@/lib/docgen/resume'
import { buildCoverLetterDocx } from '@/lib/docgen/coverLetter'
import { toCoverLetterContent, toResumeContent } from '@/lib/docgen/mapProfile'
import { isStorageConfigured, uploadDocx } from '@/lib/storage'
import type { FitScore, JobReqs, Profile, TailoredContent } from '@/lib/schemas'

export interface PacketInput {
  resumeText: string
  jdText: string
  /** Sensitive terms that may appear only if present in the profile (e.g. ['Kubernetes']). */
  bannedTerms?: string[]
  /** Date string for the cover letter; defaults to today (injectable for tests). */
  date?: string
}

export interface DocumentRef {
  filename: string
  /** Present when stored in Supabase Storage. */
  signedUrl?: string
  /** Present when Storage is unconfigured/unavailable — the docx inline, base64-encoded. */
  base64?: string
}

export interface PacketDocuments {
  storage: 'supabase' | 'inline'
  resume: DocumentRef
  coverLetter: DocumentRef
}

export interface Packet {
  profile: Profile
  jobReqs: JobReqs
  fit: FitScore
  tailored: TailoredContent
  guardrails: GuardrailReport
  /** Generated docs — null when a guardrail blocked the packet (nothing ships). */
  documents: PacketDocuments | null
}

function safeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'candidate'
}

function todayString(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

async function generateDocuments(
  profile: Profile,
  tailored: TailoredContent,
  jobReqs: JobReqs,
  date: string,
): Promise<PacketDocuments> {
  const [resumeBuf, coverBuf] = await Promise.all([
    buildResumeDocx(toResumeContent(profile, tailored, jobReqs)),
    buildCoverLetterDocx(toCoverLetterContent(profile, tailored, jobReqs, date)),
  ])

  const base = safeName(profile.name)
  const resumeName = `${base}_Resume.docx`
  const coverName = `${base}_Cover_Letter.docx`

  if (isStorageConfigured()) {
    try {
      const id = crypto.randomUUID()
      const [r, c] = await Promise.all([
        uploadDocx(resumeBuf, 'resumes', `${id}-resume`, resumeName),
        uploadDocx(coverBuf, 'cover-letters', `${id}-cover`, coverName),
      ])
      return {
        storage: 'supabase',
        resume: { filename: resumeName, signedUrl: r.signedUrl },
        coverLetter: { filename: coverName, signedUrl: c.signedUrl },
      }
    } catch (err) {
      // Bucket missing or transient error — fall back to inline so the packet still ships.
      console.error('[packet] storage upload failed, returning docs inline', err)
    }
  }

  return {
    storage: 'inline',
    resume: { filename: resumeName, base64: resumeBuf.toString('base64') },
    coverLetter: { filename: coverName, base64: coverBuf.toString('base64') },
  }
}

/**
 * Run the hero pipeline end to end. `guardrails.ok` is the ship/block signal: a failed
 * no-fabrication check must NOT ship — documents stay null and the route returns it for
 * regeneration or human review (Engineering Plan §6).
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  const profile = await structureResume(input.resumeText)
  const jobReqs = await parseJob(input.jdText)

  const [fit, tailored] = await Promise.all([
    scoreFit(profile, jobReqs),
    tailorResume(profile, jobReqs),
  ])

  const guardrails = runGuardrails(tailored, profile, {
    bannedTerms: input.bannedTerms ?? BANNED_TERMS,
    style: { allowEmDash: STYLE_RULES.allowEmDash },
  })

  const documents = guardrails.ok
    ? await generateDocuments(profile, tailored, jobReqs, input.date ?? todayString())
    : null

  return { profile, jobReqs, fit, tailored, guardrails, documents }
}

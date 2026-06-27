// Packet pipeline orchestrator (Engineering Plan §5). Sequences the individually-tested steps,
// runs the deterministic guardrails, then generates the .docx packet. The /api/packet route
// that calls this sets runtime='nodejs' (docx Packer + Supabase upload need Node).
import { structureResume } from './structureResume'
import { parseJob } from './parseJob'
import { extractFitInput } from './extractFitInput'
import { assessFit, type FitInput, type FitResult } from '@/lib/fit/fitScore'
import { tailorResume } from './tailorResume'
import { runGuardrails, type GuardrailReport } from '@/lib/guardrails'
import { BANNED_TERMS, STYLE_RULES } from '@/lib/profileRules'
import { buildResumeDocx } from '@/lib/docgen/resume'
import { buildCoverLetterDocx } from '@/lib/docgen/coverLetter'
import { buildFitAssessmentDocx } from '@/lib/docgen/fitAssessment'
import { toCoverLetterContent, toFitAssessmentContent, toResumeContent } from '@/lib/docgen/mapProfile'
import { isStorageConfigured, uploadDocx } from '@/lib/storage'
import type { CandidatePreferences, JobReqs, Profile, TailoredContent } from '@/lib/schemas'

export interface PacketInput {
  jdText: string
  /** Raw resume text to structure on the fly (stateless path). */
  resumeText?: string
  /** A pre-structured profile (reuse path) — when set, structureResume is skipped. */
  profile?: Profile
  /** Candidate preferences (target comp/lane drive the fit engine; rest are persisted context). */
  preferences?: CandidatePreferences
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
  fitAssessment: DocumentRef
}

export interface Packet {
  profile: Profile
  jobReqs: JobReqs
  fit: FitResult
  /** The extracted signals the score was computed from (drives the keyword/coverage view). */
  fitInput: FitInput
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
  fit: FitResult,
  date: string,
): Promise<PacketDocuments> {
  const [resumeBuf, coverBuf, fitBuf] = await Promise.all([
    buildResumeDocx(toResumeContent(profile, tailored, jobReqs)),
    buildCoverLetterDocx(toCoverLetterContent(profile, tailored, jobReqs, date)),
    buildFitAssessmentDocx(toFitAssessmentContent(profile, fit, jobReqs, date)),
  ])

  const base = safeName(profile.name)
  const resumeName = `${base}_Resume.docx`
  const coverName = `${base}_Cover_Letter.docx`
  const fitName = `${base}_Fit_Assessment.docx`

  if (isStorageConfigured()) {
    try {
      const id = crypto.randomUUID()
      const [r, c, f] = await Promise.all([
        uploadDocx(resumeBuf, 'resumes', `${id}-resume`, resumeName),
        uploadDocx(coverBuf, 'cover-letters', `${id}-cover`, coverName),
        uploadDocx(fitBuf, 'fit-assessments', `${id}-fit`, fitName),
      ])
      return {
        storage: 'supabase',
        resume: { filename: resumeName, signedUrl: r.signedUrl },
        coverLetter: { filename: coverName, signedUrl: c.signedUrl },
        fitAssessment: { filename: fitName, signedUrl: f.signedUrl },
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
    fitAssessment: { filename: fitName, base64: fitBuf.toString('base64') },
  }
}

/** Carries which pipeline step failed, so the route can report it without log-diving. */
export class PacketError extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`packet step '${step}' failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'PacketError'
  }
}

/** Tag any thrown error with the step name, and log every step's outcome + duration. */
async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[packet] step ok: ${step} (${Date.now() - start}ms)`)
    return result
  } catch (err) {
    console.error(`[packet] step failed: ${step} (${Date.now() - start}ms)`, err)
    throw new PacketError(step, err)
  }
}

/**
 * Run the hero pipeline end to end. `guardrails.ok` is the ship/block signal: a failed
 * no-fabrication check must NOT ship — documents stay null and the route returns it for
 * regeneration or human review (Engineering Plan §6). Each step is tagged so a failure
 * surfaces which stage broke (PacketError.step).
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  // Reuse a stored profile when provided; otherwise structure the raw resume text.
  if (!input.profile && !input.resumeText) {
    throw new PacketError('input', new Error('buildPacket requires either profile or resumeText'))
  }
  const profile =
    input.profile ??
    (await runStep('structureResume', () => structureResume(input.resumeText as string)))
  const jobReqs = await runStep('parseJob', () => parseJob(input.jdText))

  // Fit: the LLM EXTRACTS signals (fuzzy), then the deterministic engine SCORES them (exact).
  const [fitInput, tailored] = await Promise.all([
    runStep('extractFitInput', () => extractFitInput(profile, jobReqs, input.preferences)),
    runStep('tailorResume', () => tailorResume(profile, jobReqs)),
  ])
  const fit = assessFit(fitInput)

  const guardrails = runGuardrails(tailored, profile, {
    bannedTerms: input.bannedTerms ?? BANNED_TERMS,
    style: { allowEmDash: STYLE_RULES.allowEmDash },
  })

  const documents = guardrails.ok
    ? await runStep('generateDocuments', () =>
        generateDocuments(profile, tailored, jobReqs, fit, input.date ?? todayString()),
      )
    : null

  return { profile, jobReqs, fit, fitInput, tailored, guardrails, documents }
}

// Packet pipeline orchestrator (Engineering Plan §5). Sequences the individually-tested steps,
// runs the deterministic guardrails, then generates the .docx packet. The /api/packet route
// that calls this sets runtime='nodejs' (docx Packer + Supabase upload need Node).
import { structureResume } from './structureResume'
import { parseJob } from './parseJob'
import { extractFitInput } from './extractFitInput'
import { assessFit, type FitInput, type FitResult } from '@/lib/fit/fitScore'
import { tailorResume } from './tailorResume'
import { recommendStyle } from './recommendStyle'
import { runGuardrails, type GuardrailReport } from '@/lib/guardrails'
import { BANNED_TERMS, STYLE_RULES } from '@/lib/profileRules'
import { buildResumeDocx } from '@/lib/docgen/resume'
import { buildCoverLetterDocx } from '@/lib/docgen/coverLetter'
import { buildFitAssessmentDocx } from '@/lib/docgen/fitAssessment'
import { toCoverLetterContent, toFitAssessmentContent, toResumeContent } from '@/lib/docgen/mapProfile'
import { isStorageConfigured, uploadDocx } from '@/lib/storage'
import themes from '@/lib/style/themes.json'
import fonts from '@/lib/style/fonts.json'
import { resolveAssessmentAccent } from '@/lib/style/assessmentAccent'
import type { CandidatePreferences, JobReqs, Profile, TailoredContent } from '@/lib/schemas'
import type { Theme, FontPair, StyleRecord } from '@/lib/style/types'

export interface PacketInput {
  jdText: string
  /** Raw resume text to structure on the fly (stateless path). */
  resumeText?: string
  /** A pre-structured profile (reuse path) — when set, structureResume is skipped. */
  profile?: Profile
  /** Original resume text for the reuse path (the stateless path uses resumeText). Grounds the
   *  shipped bullets/summary against the source in the no-fabrication guardrail (ai-26). */
  sourceResumeText?: string
  /** Candidate preferences (target comp/lane drive the fit engine; rest are persisted context). */
  preferences?: CandidatePreferences
  /** Style override (theme + font). Absent → master default (navy_copper / cambria_calibri). */
  style?: StyleRecord
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
  /** The style actually applied to the documents (user override, recommendation, or master). */
  style: StyleRecord
  /** Why the style was chosen — present for a recommendation; absent for an explicit user pick. */
  styleWhy?: string
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
  style: StyleRecord,
): Promise<PacketDocuments> {
  // Resolve the Theme + FontPair objects from the style ids, falling back to the master entries
  // (defensive: an unknown id must never crash generation). The assessment uses the collision-
  // guarded accent, not theme.accent directly.
  const allThemes = themes.themes as Theme[]
  const allFonts = fonts.pairs as FontPair[]
  const theme = allThemes.find((t) => t.id === style.theme) ?? allThemes.find((t) => t.master)
  const font = allFonts.find((f) => f.id === style.font) ?? allFonts.find((f) => f.master)
  if (!theme || !font) throw new Error('Style data is missing a master theme/font')
  const accent = resolveAssessmentAccent(theme)

  const [resumeBuf, coverBuf, fitBuf] = await Promise.all([
    buildResumeDocx(toResumeContent(profile, tailored, jobReqs), theme, font),
    buildCoverLetterDocx(toCoverLetterContent(profile, tailored, jobReqs, date), theme, font),
    buildFitAssessmentDocx(toFitAssessmentContent(profile, fit, jobReqs, date), theme, accent),
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
  // Style recommendation rides in the same parallel batch when the caller didn't pick a style, so
  // it adds no wall-clock (a cheap Haiku call alongside the Sonnet ones) and never blocks shipping
  // (recommendStyle is fail-soft). Skip it entirely when the user already chose a style.
  const needRecommend = !input.style
  const [fitInput, tailored, recommendation] = await Promise.all([
    runStep('extractFitInput', () => extractFitInput(profile, jobReqs, input.preferences)),
    runStep('tailorResume', () => tailorResume(profile, jobReqs)),
    needRecommend
      ? runStep('recommendStyle', () => recommendStyle(profile, jobReqs))
      : Promise.resolve(null),
  ])
  const fit = assessFit(fitInput)

  // ATS-safety asserted on the shipping content. The docgen builders are single-column with no
  // tables/images by construction (lib/docgen/*), so those structural fields are fixed; the
  // meaningful runtime gate is that real selectable text exists (textRunCount > 0).
  const atsDoc = {
    columns: 1,
    hasTables: false,
    hasImages: false,
    textRunCount: (tailored.summary.trim() ? 1 : 0) + tailored.skills.length + tailored.claims.length,
  }

  const guardrails = runGuardrails(tailored, profile, {
    // BANNED_TERMS is a mandatory floor: callers may ADD watched terms, never remove the standing
    // ones (the standing corrections in profileRules.ts must never regress).
    bannedTerms: [...new Set([...BANNED_TERMS, ...(input.bannedTerms ?? [])])],
    style: { allowEmDash: STYLE_RULES.allowEmDash },
    atsDoc,
    // Ground shipped bullets against the source resume: the raw text on the stateless path, or the
    // stored source on the reuse path. The profile itself is LLM-derived, so it can't be the truth.
    sourceResumeText: input.resumeText ?? input.sourceResumeText,
  })

  // Style precedence: explicit user pick → recommendation → master default. The master fallback
  // means an absent style + a failed recommendation still produces the pre-feature output.
  const style: StyleRecord = input.style ?? recommendation?.style ?? MASTER_STYLE
  const styleWhy = input.style ? undefined : recommendation?.why

  const documents = guardrails.ok
    ? await runStep('generateDocuments', () =>
        generateDocuments(profile, tailored, jobReqs, fit, input.date ?? todayString(), style),
      )
    : null

  return { profile, jobReqs, fit, fitInput, tailored, guardrails, documents, style, styleWhy }
}

/** The master skin — navy_copper / cambria_calibri. Absent style → identical output to pre-feature. */
const MASTER_STYLE: StyleRecord = { theme: 'navy_copper', font: 'cambria_calibri', source: 'default' }

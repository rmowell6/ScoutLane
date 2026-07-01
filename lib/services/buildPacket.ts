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
import { buildResumePdf, buildCoverLetterPdf, buildFitAssessmentPdf } from '@/lib/docgen/pdf'
import { toCoverLetterContent, toFitAssessmentContent, toResumeContent } from '@/lib/docgen/mapProfile'
import { isStorageConfigured, uploadDoc, FORMAT_META, type DocFormat } from '@/lib/storage'
import themes from '@/lib/style/themes.json'
import fonts from '@/lib/style/fonts.json'
import { resolveAssessmentAccent } from '@/lib/style/assessmentAccent'
import type { CandidatePreferences, JobReqs, Profile, TailoredContent } from '@/lib/schemas'
import type { Theme, FontPair, StyleRecord } from '@/lib/style/types'

export interface PacketInput {
  jdText: string
  /** Raw resume text to structure on the fly (stateless path). */
  resumeText?: string
  /** A pre-structured profile (reuse path), when set, structureResume is skipped. */
  profile?: Profile
  /** Original resume text for the reuse path (the stateless path uses resumeText). Grounds the
   *  shipped bullets/summary against the source in the no-fabrication guardrail (ai-26). */
  sourceResumeText?: string
  /** Candidate preferences (target comp/lane drive the fit engine; rest are persisted context). */
  preferences?: CandidatePreferences
  /** Style override (theme + font). Absent → master default (navy_copper / cambria_calibri). */
  style?: StyleRecord
  /** Pooled-job id (pooled-job path). Lets the style recommender cache its classification on the
   *  job row, so a repeat packet against the same posting skips the classification LLM call. */
  jobId?: string
  /** Sensitive terms that may appear only if present in the profile (e.g. ['Kubernetes']). */
  bannedTerms?: string[]
  /** Date string for the cover letter; defaults to today (injectable for tests). */
  date?: string
}

export interface DocumentRef {
  filename: string
  /** MIME type of this file, the browser uses it when reconstructing an inline (base64) download. */
  mime: string
  /** Present when stored in Supabase Storage. */
  signedUrl?: string
  /** Present when Storage is unconfigured/unavailable, the file inline, base64-encoded. */
  base64?: string
}

/** Every packet document ships in each supported format (PDF to view/print, DOCX to edit). */
export type DocFormats = Record<DocFormat, DocumentRef>

export interface PacketDocuments {
  storage: 'supabase' | 'inline'
  resume: DocFormats
  coverLetter: DocFormats
  fitAssessment: DocFormats
}

export interface Packet {
  profile: Profile
  jobReqs: JobReqs
  fit: FitResult
  /** The extracted signals the score was computed from (drives the keyword/coverage view). */
  fitInput: FitInput
  tailored: TailoredContent
  guardrails: GuardrailReport
  /** Generated docs, null when a guardrail blocked the packet (nothing ships). */
  documents: PacketDocuments | null
  /** The style actually applied to the documents (user override, recommendation, or master). */
  style: StyleRecord
  /** Why the style was chosen, present for a recommendation; absent for an explicit user pick. */
  styleWhy?: string
}

function safeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'candidate'
}

/**
 * Build the saved-as filename stem: `<Candidate>_<Company>_<DocType>` (e.g. Joe_Smith_Acme_Resume).
 * The company segment is dropped when the JD has no company, so the name never has an empty gap.
 */
function fileStem(candidate: string, company: string | undefined, docType: string): string {
  const co = company ? safeName(company) : ''
  return [safeName(candidate), co, docType].filter(Boolean).join('_')
}

function todayString(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

async function generateDocuments(
  profile: Profile,
  tailored: TailoredContent,
  jobReqs: JobReqs,
  fit: FitResult,
  fitInput: FitInput,
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

  // Map each of the three documents to its content + both-format builders, so DOCX and PDF are
  // generated from the SAME content and can never drift. `prefix`/`slug` place the files in Storage.
  const resumeContent = toResumeContent(profile, tailored, jobReqs)
  const coverContent = toCoverLetterContent(profile, tailored, jobReqs, date)
  const fitContent = toFitAssessmentContent(profile, fit, fitInput, jobReqs, date)
  const company = jobReqs.company ?? undefined
  const specs = [
    {
      key: 'resume' as const,
      prefix: 'resumes',
      slug: 'resume',
      stem: fileStem(profile.name, company, 'Resume'),
      docx: () => buildResumeDocx(resumeContent, theme, font),
      pdf: () => buildResumePdf(resumeContent, theme),
    },
    {
      key: 'coverLetter' as const,
      prefix: 'cover-letters',
      slug: 'cover',
      stem: fileStem(profile.name, company, 'Cover_Letter'),
      docx: () => buildCoverLetterDocx(coverContent, theme, font),
      pdf: () => buildCoverLetterPdf(coverContent, theme),
    },
    {
      key: 'fitAssessment' as const,
      prefix: 'fit-assessments',
      slug: 'fit',
      stem: fileStem(profile.name, company, 'Fit_Assessment'),
      docx: () => buildFitAssessmentDocx(fitContent, theme, accent),
      pdf: () => buildFitAssessmentPdf(fitContent, theme, accent),
    },
  ]

  // Build every (document × format) buffer up front (in parallel); how we serve them is decided below.
  // Kick off both formats before awaiting either: an object literal evaluates its properties left to
  // right, so `{ pdf: await s.pdf(), docx: await s.docx() }` would fully build the PDF before the DOCX
  // even starts. The two builders are independent, so run them concurrently.
  const formats: DocFormat[] = ['pdf', 'docx']
  const built = await Promise.all(
    specs.map(async (s) => {
      const [pdf, docx] = await Promise.all([s.pdf(), s.docx()])
      return { spec: s, buffers: { pdf, docx } as Record<DocFormat, Buffer> }
    }),
  )

  const filenameOf = (stem: string, format: DocFormat) => `${stem}.${FORMAT_META[format].ext}`
  const mimeOf = (format: DocFormat) => FORMAT_META[format].contentType

  if (isStorageConfigured()) {
    try {
      const id = crypto.randomUUID()
      const uploaded = await Promise.all(
        built.map(async ({ spec, buffers }) => {
          // Upload both formats of a document concurrently: each uploadDoc is an independent network
          // round trip to Storage, so a serial `for` loop would stack their latencies for no reason.
          const entries = await Promise.all(
            formats.map(async (format) => {
              const filename = filenameOf(spec.stem, format)
              const { signedUrl } = await uploadDoc(buffers[format], format, spec.prefix, `${id}-${spec.slug}`, filename)
              return [format, { filename, mime: mimeOf(format), signedUrl }] as const
            }),
          )
          return [spec.key, Object.fromEntries(entries) as DocFormats] as const
        }),
      )
      const byKey = Object.fromEntries(uploaded) as Record<(typeof specs)[number]['key'], DocFormats>
      return { storage: 'supabase', ...byKey }
    } catch (err) {
      // Bucket missing or transient error, fall back to inline so the packet still ships.
      console.error('[packet] storage upload failed, returning docs inline', err)
    }
  }

  const inline = Object.fromEntries(
    built.map(({ spec, buffers }) => {
      const refs = {} as DocFormats
      for (const format of formats) {
        refs[format] = {
          filename: filenameOf(spec.stem, format),
          mime: mimeOf(format),
          base64: buffers[format].toString('base64'),
        }
      }
      return [spec.key, refs]
    }),
  ) as Record<(typeof specs)[number]['key'], DocFormats>
  return { storage: 'inline', ...inline }
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
 * no-fabrication check must NOT ship, documents stay null and the route returns it for
 * regeneration or human review (Engineering Plan §6). Each step is tagged so a failure
 * surfaces which stage broke (PacketError.step).
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  // Reuse a stored profile when provided; otherwise structure the raw resume text.
  if (!input.profile && !input.resumeText) {
    throw new PacketError('input', new Error('buildPacket requires either profile or resumeText'))
  }
  // structureResume (resume text -> profile) and parseJob (jd text -> requirements) share no data,
  // so run them concurrently. On the stateless path this saves a full LLM round trip of latency
  // before the fit/tailor/style batch below. runStep still tags and logs each step independently, so
  // a failure in either still surfaces the right PacketError.step.
  const [profile, jobReqs] = await Promise.all([
    input.profile
      ? Promise.resolve(input.profile)
      : runStep('structureResume', () => structureResume(input.resumeText as string)),
    runStep('parseJob', () => parseJob(input.jdText)),
  ])

  // Fit: the LLM EXTRACTS signals (fuzzy), then the deterministic engine SCORES them (exact).
  // Style recommendation rides in the same parallel batch when the caller didn't pick a style, so
  // it adds no wall-clock (a cheap Haiku call alongside the Sonnet ones) and never blocks shipping
  // (recommendStyle is fail-soft). Skip it entirely when the user already chose a style.
  const needRecommend = !input.style
  const [fitInput, tailored, recommendation] = await Promise.all([
    runStep('extractFitInput', () => extractFitInput(profile, jobReqs, input.jdText, input.preferences)),
    runStep('tailorResume', () => tailorResume(profile, jobReqs)),
    needRecommend
      ? runStep('recommendStyle', () => recommendStyle(profile, jobReqs, input.jobId))
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
        generateDocuments(profile, tailored, jobReqs, fit, fitInput, input.date ?? todayString(), style),
      )
    : null

  return { profile, jobReqs, fit, fitInput, tailored, guardrails, documents, style, styleWhy }
}

/** The master skin, navy_copper / cambria_calibri. Absent style → identical output to pre-feature. */
const MASTER_STYLE: StyleRecord = { theme: 'navy_copper', font: 'cambria_calibri', source: 'default' }

// Deterministic guardrails — run AFTER the model and trust nothing (Engineering Plan §6).
// The no-fabrication check is the product's differentiator: every tailored claim must trace
// to a real profile fact, enforced in code, not by prompt wording. A failed check blocks or
// flags — it never ships silently.
import type { Profile, TailoredContent, Claim } from '@/lib/schemas'

// ---- fact indexing ---------------------------------------------------------------

export interface FactIndex {
  /** factId -> original fact text */
  byId: Map<string, string>
  /** normalized fact texts, for substring/term checks */
  texts: string[]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Build a stable, addressable index of every source fact in the profile. */
export function indexFacts(profile: Profile): FactIndex {
  const byId = new Map<string, string>()

  profile.skills.forEach((s, i) => byId.set(`skill:${i}`, s))
  profile.certs.forEach((c, i) => byId.set(`cert:${i}`, c))
  profile.roles.forEach((role, i) => {
    byId.set(`role:${i}:title`, role.title)
    byId.set(`role:${i}:company`, role.company)
    role.bullets.forEach((b, j) => byId.set(`role:${i}:bullet:${j}`, b))
  })
  profile.education.forEach((e, i) =>
    byId.set(`edu:${i}`, [e.degree, e.field, e.school].filter(Boolean).join(' ')),
  )

  const texts = [...byId.values()].map(normalize)
  return { byId, texts }
}

/** A claim is traceable iff it names a factId that exists in the index. */
export function traceable(claim: Claim, index: FactIndex): boolean {
  // Primary: the claim cites a real fact id.
  if (claim.factId !== null && index.byId.has(claim.factId)) return true
  // Fallback: the claim verbatim-restates a real fact (the model paraphrased the id wrong or
  // left it null but did not fabricate). Kept strict — a near-exact substring of a source fact,
  // length-gated so trivial fragments can't match. Paraphrases still fail, as they should.
  const t = normalize(claim.text)
  return t.length >= 12 && index.texts.some((fact) => fact.includes(t))
}

// ---- individual checks -----------------------------------------------------------

export interface NoFabricationResult {
  ok: boolean
  unverifiable: Claim[]
}

/** No fabrication: every tailored claim must trace to a source fact. */
export function checkNoFabrication(
  tailored: TailoredContent,
  profile: Profile,
): NoFabricationResult {
  const index = indexFacts(profile)
  const unverifiable = tailored.claims.filter((c) => !traceable(c, index))
  return { ok: unverifiable.length === 0, unverifiable }
}

/** Match a term as a whole word (single token) or substring (multi-word). */
function mentions(haystack: string, term: string): boolean {
  const t = normalize(term)
  if (!t) return false
  if (/\s/.test(t)) return haystack.includes(t)
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(haystack)
}

export interface BannedTermsResult {
  ok: boolean
  violations: string[]
}

/**
 * Banned terms: a sensitive term (e.g. "Kubernetes") may appear in the tailored output only
 * if it is present somewhere in the profile facts. Caller supplies the watch list.
 */
export function checkBannedTerms(
  tailored: TailoredContent,
  profile: Profile,
  bannedTerms: string[],
): BannedTermsResult {
  const profileText = indexFacts(profile).texts.join(' \n ')
  const tailoredText = normalize(
    [tailored.summary, tailored.coverLetter, ...tailored.skills, ...tailored.claims.map((c) => c.text)].join(' '),
  )
  const violations = bannedTerms.filter(
    (term) => mentions(tailoredText, term) && !mentions(profileText, term),
  )
  return { ok: violations.length === 0, violations }
}

export interface StyleOptions {
  /** Disallow em dashes (—) per the house style. Default true. */
  allowEmDash?: boolean
}

export interface StyleResult {
  ok: boolean
  violations: string[]
}

/** Style: em-dash policy and basic voice hygiene. */
export function checkStyle(text: string, options: StyleOptions = {}): StyleResult {
  const { allowEmDash = false } = options
  const violations: string[] = []
  if (!allowEmDash && text.includes('—')) violations.push('contains em dash (—)')
  // Flag repeated *spaces* within a line only — newlines and blank-line paragraph breaks are
  // intentional (cover letters), so they must not trip this check.
  if (/ {2,}/.test(text)) violations.push('contains repeated spaces')
  return { ok: violations.length === 0, violations }
}

/** Minimal structural view of a generated document for ATS assertions. */
export interface AtsDocModel {
  columns: number
  hasTables: boolean
  hasImages: boolean
  textRunCount: number
}

export interface AtsResult {
  ok: boolean
  problems: string[]
}

/** ATS-safe: single-column, no tables/images, real selectable text. */
export function checkAtsSafe(doc: AtsDocModel): AtsResult {
  const problems: string[] = []
  if (doc.columns > 1) problems.push('multi-column layout')
  if (doc.hasTables) problems.push('contains tables')
  if (doc.hasImages) problems.push('contains images')
  if (doc.textRunCount === 0) problems.push('no real text')
  return { ok: problems.length === 0, problems }
}

// ---- aggregate -------------------------------------------------------------------

export interface GuardrailOptions {
  bannedTerms?: string[]
  style?: StyleOptions
  atsDoc?: AtsDocModel
}

export interface GuardrailReport {
  ok: boolean
  noFabrication: NoFabricationResult
  bannedTerms: BannedTermsResult
  style: StyleResult
  ats: AtsResult | null
}

/** Run all guardrails and roll up a single pass/fail report. */
export function runGuardrails(
  tailored: TailoredContent,
  profile: Profile,
  options: GuardrailOptions = {},
): GuardrailReport {
  const noFabrication = checkNoFabrication(tailored, profile)
  const bannedTerms = checkBannedTerms(tailored, profile, options.bannedTerms ?? [])
  const styleText = [tailored.summary, tailored.coverLetter, ...tailored.claims.map((c) => c.text)].join('\n')
  const style = checkStyle(styleText, options.style)
  const ats = options.atsDoc ? checkAtsSafe(options.atsDoc) : null

  const ok = noFabrication.ok && bannedTerms.ok && style.ok && (ats?.ok ?? true)
  return { ok, noFabrication, bannedTerms, style, ats }
}

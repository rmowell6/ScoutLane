// Deterministic guardrails, run AFTER the model and trust nothing (Engineering Plan §6).
// The no-fabrication check is the product's differentiator: every tailored claim must trace
// to a real profile fact, enforced in code, not by prompt wording. A failed check blocks or
// flags, it never ships silently.
import type { Profile, TailoredContent, Claim } from '@/lib/schemas'

// ---- fact indexing ---------------------------------------------------------------

export interface FactIndex {
  /** factId -> original fact text */
  byId: Map<string, string>
  /** normalized fact texts, for substring/term checks */
  texts: string[]
}

// Fold whitespace AND every hyphen/dash variant to a single space, so grounding is insensitive to
// punctuation reformatting. Example: a resume skill "Windows Server 2012–2022" (en dash, as parsed
// from a .docx) and the tailor's "Windows Server 2012-2022" (the model drops the dash per the
// no-em-dash house rule) must still match, otherwise a real, listed skill reads as fabricated and
// the packet is wrongly blocked. This only equates separators; it can never let an actual
// fabrication pass (all the words must still be present).
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s‐-―−-]+/g, ' ') // whitespace + hyphen/dash variants (U+2010 to U+2015, minus sign, ASCII hyphen)
    .trim()
}

/** Build a stable, addressable index of every source fact in the profile. */
export function indexFacts(profile: Profile): FactIndex {
  const byId = new Map<string, string>()

  if (profile.summary) byId.set('summary', profile.summary)
  profile.skills.forEach((s, i) => byId.set(`skill:${i}`, s))
  profile.certs.forEach((c, i) => byId.set(`cert:${i}`, c.name))
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

// "Glue" words the tailor may insert or drop when it rephrases a fact, articles, prepositions,
// conjunctions, light auxiliaries, and the list-introducing verbs/gerunds a model reaches for when
// it strips an em dash ("services, VMs" -> "services including/covering/spanning VMs"). Crucially
// this set contains ONLY generic function words, NEVER a domain term, so allowing the claim to add
// one can never launder a fabrication (an invented skill/metric/credential is never on this list).
// The check therefore fails CLOSED: an unknown connector over-blocks (a safe annoyance), it never
// under-blocks. Widen this list freely; do not add content words.
const GLUE_WORDS = new Set([
  // articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'such', 'its', 'their', 'it',
  // conjunctions
  'and', 'or', 'nor', 'but', 'as', 'than', 'while', 'whereas', 'namely',
  // prepositions
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'via', 'per', 'from', 'into', 'onto', 'upon',
  'over', 'under', 'across', 'through', 'within', 'between', 'among', 'around', 'about', 'during',
  'regarding', 'concerning', 'plus', 'also', 'where', 'when',
  // list-introducing verbs / gerunds (replace an em dash before an enumeration)
  'including', 'include', 'includes', 'included', 'covering', 'covers', 'covered', 'spanning',
  'spans', 'comprising', 'comprised', 'comprises', 'consisting', 'consists', 'encompassing',
  'encompasses', 'involving', 'involves', 'featuring', 'features', 'containing', 'contains',
  // light auxiliaries / copulas
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'which', 'who', 'whom', 'whose',
])
// Polarity words whose presence flips meaning. The claim must carry the SAME set as the fact, so a
// rephrasing can never silently drop a "not"/"failed" (the misrepresentation the substring rule
// guarded). Contraction stems are included since punctuation is stripped before matching.
const NEGATION_WORDS = new Set([
  'no', 'not', 'never', 'without', 'none', 'cannot', 'cant', 'fail', 'failed', 'fails', 'unable',
  'nor', 'dont', 'didnt', 'doesnt', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'couldnt', 'wouldnt', 'shouldnt',
])

/** All lowercased alphanumeric word tokens (drops punctuation only), via the shared dash/space
 *  normalize. Unlike contentTokens() this keeps short words ("no", "vms"), they matter for negation
 *  polarity and for catching added substantive tokens. */
function wordTokens(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Negation/polarity tokens present in a token set, as a stable key for equality. */
function negationKey(tokens: Set<string>): string {
  return [...tokens].filter((w) => NEGATION_WORDS.has(w)).sort().join(',')
}

/** True when a single fact carries any negation/polarity word: the fact asserts an absence, not a
 *  capability. Whole-fact scope (not term-proximity) on purpose: it is the conservative, fail-CLOSED
 *  reading. A mixed "no Java but expert Kubernetes" fact is treated as negated (a safe over-block); we
 *  never let a fact the profile explicitly disclaims count as grounding. */
function factIsNegated(fact: string): boolean {
  return negationKey(new Set(wordTokens(fact))) !== ''
}

/** Grounded iff `term` appears in at least one NON-negated fact. Grounding against the flattened
 *  profile text (the old approach) let a disclaimer ground the very skill it denies: "No hands-on
 *  Kubernetes experience" wrongly grounded "Kubernetes". Checking fact-by-fact and skipping any negated
 *  fact fixes that while keeping every real, positively-stated skill grounded. Fails CLOSED: when in
 *  doubt a term reads as ungrounded (over-blocks), never as silently grounded. */
function groundedInFacts(facts: string[], term: string): boolean {
  return facts.some((fact) => !factIsNegated(fact) && mentions(fact, term))
}

/** Near-equality: a faithful restatement of `fact`, NOT a one-directional stripped fragment (which
 *  can misrepresent, e.g. dropping a leading "Failed to") nor a fabrication that embeds a short real
 *  phrase. Two routes:
 *   1. Substring: the shorter covers >= 70% of the longer (fast path for verbatim-ish text).
 *   2. Token faithfulness: the claim introduces NO new substantive word (only glue words may be
 *      added, anti-fabrication), covers >= 70% of the fact's tokens (not a tiny fragment), and
 *      carries the same negation polarity (no silent meaning flip). This tolerates the rephrasings
 *      our own tailor makes, swapping an em dash for "including"/a comma, dropping a "(a, b, c)"
 *      parenthetical, which the substring rule wrongly rejected. */
function isFaithfulRestatement(t: string, fact: string): boolean {
  if (fact === t) return true

  const claimTokens = wordTokens(t)
  const claimSet = new Set(claimTokens)
  const factSet = new Set(wordTokens(fact))
  if (factSet.size === 0) return false

  // "Substantial" = a real assertion, not a cherry-picked sliver. EITHER it restates most of the
  // fact's tokens, OR it carries enough of its own content words to stand on its own. The second
  // branch is the fix: a faithful PARTIAL restatement of a LONG fact (e.g. a 20+ word prefix of the
  // summary) covers well under 70% of that long fact, yet is obviously not a misleading fragment. The
  // old "covers >= 70% of the fact" rule wrongly blocked exactly that, and the summary is the longest
  // fact, so it was the most affected.
  const claimContentCount = claimTokens.filter((w) => !GLUE_WORDS.has(w)).length
  let covered = 0
  for (const w of factSet) if (claimSet.has(w)) covered++
  const substantial = covered / factSet.size >= 0.7 || claimContentCount >= 6

  // Route 1, verbatim substring of the fact (claim ⊆ fact): every word is present, in order, so it
  // cannot fabricate. Accept when substantial AND it doesn't drop a polarity word the rest of the fact
  // carried (e.g. a leading "Failed to"). If the claim is LONGER than the fact, fall through so the
  // token route below checks the ADDED words for fabrication.
  if (t.length <= fact.length && fact.includes(t)) {
    if (substantial && negationKey(claimSet) === negationKey(factSet)) return true
  }

  // Route 2, token faithfulness for light rephrasings (em dash -> comma/"including", dropped
  // parenthetical). Anti-fabrication: every substantive (non-glue) claim token must come from the
  // fact. Then it must be substantial, and carry the same negation polarity (no silent meaning flip).
  for (const w of claimSet) {
    if (!factSet.has(w) && !GLUE_WORDS.has(w)) return false
  }
  if (!substantial) return false
  return negationKey(claimSet) === negationKey(factSet)
}

/**
 * A claim is traceable iff its TEXT faithfully restates the fact it cites, citing a valid factId is
 * NOT sufficient on its own. The earlier `factId exists -> true` shortcut let an injected instruction
 * launder a fabricated sentence behind any real id (the resume/JD are untrusted, prompt-injection
 * surface). Now the text is diffed against the specific cited fact; with no/invalid id we fall back
 * to faithful restatement of ANY single fact (the model left it null or mis-cited but didn't invent).
 */
export function traceable(claim: Claim, index: FactIndex): boolean {
  const t = normalize(claim.text)
  // Cited path: prefer the CITED fact. If the text faithfully restates it, accept.
  if (claim.factId !== null && index.byId.has(claim.factId)) {
    if (isFaithfulRestatement(t, normalize(index.byId.get(claim.factId) as string))) return true
    // Fall through, do NOT block yet. The model routinely copies a real bullet verbatim but attaches
    // the WRONG (still valid) factId; that mis-citation must not reject a claim that faithfully restates
    // some OTHER real fact. Anti-fabrication is preserved because the fallback below still requires the
    // text to faithfully restate a genuine profile fact, a fabrication restates none and stays blocked.
  }
  // Fallback (no/invalid/mis-cited id): faithful restatement of any one fact; guard tiny fragments.
  if (t.length < 12) return false
  return index.texts.some((fact) => isFaithfulRestatement(t, fact))
}

// ---- individual checks -----------------------------------------------------------

export interface NoFabricationResult {
  ok: boolean
  unverifiable: Claim[]
  /** Tailored skills not grounded in any profile fact (they ship verbatim into the resume). */
  ungroundedSkills: string[]
  /** Quantified claims in the free-text summary / cover-letter body whose number is absent from
   *  the profile facts (e.g. an invented "cut costs 40%" or "team of 12"). */
  ungroundedMetrics: string[]
}

// ---- prose metric grounding ------------------------------------------------------
// The summary and cover-letter BODY are free prose, not structured claims, so the claim/skill
// traces below don't cover them. The most common and most damaging fabrication in that prose is an
// invented QUANTITY, "cut costs 40%", "$2M saved", "team of 12", "managed 200 servers". We extract
// numbers bound to a metric context and require each to appear in the profile facts. Bare numbers
// and 4-digit years are deliberately NOT gated (too ambiguous, e.g. a computed "10 years").

// Digit runs are bounded (`{0,24}` not `*`): a real metric never has 25+ digit/comma chars, and the
// unbounded `[\d,]*` + optional groups backtrack catastrophically on a long numeric paste, measured
// ~tens of seconds of event-loop block on a 100k-char digit string. The bound makes matching linear
// without dropping any legitimate quantity (ReDoS hardening).
const METRIC_RE = new RegExp(
  [
    String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\s*%`, // 40%, 1,200%
    String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\s*percent\b`, // 40 percent
    String.raw`\$\s?\d[\d,]{0,24}(?:\.\d{0,12})?(?:\s*(?:k|m|b|million|billion|thousand))?`, // $2M, $500,000
    String.raw`team\s+of\s+\d[\d,]{0,24}`, // team of 12
    // a count bound to a candidate-scope unit (years intentionally excluded)
    String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\+?\s*(?:people|engineers?|staff|employees|reports?|clients?|customers?|users?|servers?|vms?|sites?|branches|stores?|locations?|projects?|deployments?|tickets?|incidents?|endpoints?|devices?|nodes?|clusters?)\b`,
  ].join('|'),
  'gi',
)

/** Pull comma-stripped numeric tokens out of a string (e.g. "$500,000" -> ["500000"]). Digit run
 *  bounded ({0,24}) for the same ReDoS reason as METRIC_RE. */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]{0,24}(?:\.\d{0,12})?/g) ?? []).map((n) => n.replace(/,/g, ''))
}

/** Metric phrases in the prose whose number appears nowhere in the profile facts. */
function ungroundedMetricsIn(prose: string, profileText: string): string[] {
  const profileNums = new Set(numbersIn(profileText))
  const flagged: string[] = []
  for (const phrase of prose.match(METRIC_RE) ?? []) {
    const nums = numbersIn(phrase)
    if (nums.length > 0 && !nums.some((n) => profileNums.has(n))) flagged.push(phrase.trim())
  }
  return flagged
}

/**
 * No fabrication: every tailored CLAIM must trace to a source fact; every tailored SKILL (which
 * ships verbatim into the resume's skills section) must appear in the profile facts; and the
 * free-text summary + cover-letter body must not assert a QUANTIFIED metric (%, money, team/scope
 * count) whose number isn't in the profile facts. Style + banned-terms cover the rest of the prose.
 */
export function checkNoFabrication(
  tailored: TailoredContent,
  profile: Profile,
): NoFabricationResult {
  const index = indexFacts(profile)
  const unverifiable = tailored.claims.filter((c) => !traceable(c, index))
  const profileText = index.texts.join(' \n ')
  const ungroundedSkills = tailored.skills.filter((s) => !groundedInFacts(index.texts, s))
  // The outreach messages are fact-grounded prose too, so hold them to the same no-invented-metric bar.
  const prose = `${tailored.summary}\n${tailored.coverLetter}\n${tailored.outreach.linkedin}\n${tailored.outreach.email}`
  const ungroundedMetrics = ungroundedMetricsIn(prose, profileText)
  return {
    ok: unverifiable.length === 0 && ungroundedSkills.length === 0 && ungroundedMetrics.length === 0,
    unverifiable,
    ungroundedSkills,
    ungroundedMetrics,
  }
}

/**
 * Match a term as a whole word (single token) or substring (multi-word).
 *
 * NOTE (ai-28): grounding checks a tailored skill/term against EVERY fact (skills + certs + role
 * bullets + summary + education) via groundedInFacts, not just the structured skills/certs lists.
 * This is deliberate: a skill evidenced only in an experience bullet ("led the Azure migration") is
 * genuinely present in the profile and must be allowed to ship; restricting grounding to the skills
 * list alone would block legitimate, fact-backed tailoring. Grounding runs fact-by-fact (not against
 * one flattened string) so groundedInFacts can skip NEGATED facts. The whole-word match for single
 * tokens keeps incidental substring hits (java vs javascript) from passing.
 */
export function mentions(haystack: string, term: string): boolean {
  const t = normalize(term)
  if (!t) return false
  if (/\s/.test(t)) return haystack.includes(t)
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Token boundary that tolerates the TERM's own non-word edge chars (C++, C#, F#, .NET, Node.js):
  // match unless flanked by a WORD char (which would make it part of a larger identifier, e.g. "java"
  // inside "javascript"). `\b` fails when an edge char is non-word (+/#/.), which false-blocked real,
  // listed skills. Negative word-char lookarounds keep the whole-token intent without that bug.
  return new RegExp(`(?<!\\w)${escaped}(?!\\w)`).test(haystack)
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
  const facts = indexFacts(profile).texts
  const tailoredText = normalize(
    [
      tailored.summary,
      tailored.coverLetter,
      tailored.outreach.linkedin,
      tailored.outreach.email,
      ...tailored.skills,
      ...tailored.claims.map((c) => c.text),
    ].join(' '),
  )
  // Ground against NON-negated facts only: a term the profile explicitly disclaims (e.g. "No
  // Kubernetes experience") must not license shipping that term in the tailored output.
  const violations = bannedTerms.filter(
    (term) => mentions(tailoredText, term) && !groundedInFacts(facts, term),
  )
  return { ok: violations.length === 0, violations }
}

export interface StyleOptions {
  /** Disallow em dashes (, ) per the house style. Default true. */
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
  // Flag repeated *spaces* within a line only, newlines and blank-line paragraph breaks are
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

// ---- shipped-bullet grounding (ai-26) --------------------------------------------
// The resume EXPERIENCE bullets + summary that actually ship come from the structured profile, and
// the profile is itself LLM-derived (structureResume), so the claim-tracing above grounds them only
// CIRCULARLY (against the very profile a structuring hallucination would have corrupted). Ground the
// shipped bullets against the ORIGINAL uploaded resume text instead. Per the chosen policy:
//   - BLOCK: an invented QUANTITY in a bullet/summary whose number is absent from the source resume
//     (the most damaging fabrication class; reuses the metric grounding → near-zero false positives).
//   - FLAG (non-blocking): a bullet whose content words barely overlap the source resume, surfaced
//     for review, NOT blocked, because structureResume legitimately rephrases/condenses.

const OVERLAP_FLAG_THRESHOLD = 0.5

/** Significant lowercased word tokens (length >= 4 drops most stopwords). */
function contentTokens(s: string): Set<string> {
  return new Set(normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4))
}

/** Fraction of a text's content tokens that also appear in the source resume. */
function sourceOverlap(text: string, sourceTokens: Set<string>): number {
  const tokens = contentTokens(text)
  if (tokens.size === 0) return 1
  let hit = 0
  for (const t of tokens) if (sourceTokens.has(t)) hit++
  return hit / tokens.size
}

export interface BulletsGroundedResult {
  /** Blocking pass/fail: false iff a shipped bullet/summary asserts an ungrounded quantity. */
  ok: boolean
  /** True when no source resume was available to check against, degrade OPEN (don't block). */
  skipped: boolean
  /** Invented quantities in a shipped bullet/summary, absent from the source resume (BLOCKING). */
  ungroundedMetrics: string[]
  /** Bullets/summary with low source-word overlap, surfaced for review, NOT blocking. */
  flagged: { text: string; overlap: number }[]
}

/**
 * Ground the shipped experience bullets + summary against the ORIGINAL resume text. `ok` is driven
 * ONLY by the metric block; low-overlap bullets are flagged for review but never block (rephrasing
 * is legitimate). With no source text, the check is skipped (ok:true) so it can't block packets for
 * profiles saved before the source was threaded through.
 */
export function checkBulletsGrounded(profile: Profile, sourceResumeText?: string): BulletsGroundedResult {
  const source = (sourceResumeText ?? '').trim()
  if (!source) return { ok: true, skipped: true, ungroundedMetrics: [], flagged: [] }

  const sourceTokens = contentTokens(source)
  const shipped: string[] = []
  if (profile.summary) shipped.push(profile.summary)
  for (const role of profile.roles) for (const bullet of role.bullets) shipped.push(bullet)

  const ungroundedMetrics: string[] = []
  const flagged: { text: string; overlap: number }[] = []
  for (const text of shipped) {
    ungroundedMetrics.push(...ungroundedMetricsIn(text, source))
    const overlap = sourceOverlap(text, sourceTokens)
    if (overlap < OVERLAP_FLAG_THRESHOLD) {
      flagged.push({ text, overlap: Math.round(overlap * 100) / 100 })
    }
  }
  return { ok: ungroundedMetrics.length === 0, skipped: false, ungroundedMetrics, flagged }
}

// ---- cert currency (defense-in-depth) --------------------------------------------
// structureResume classifies each cert active vs previously_held; mapProfile renders by that status.
// This catches the dangerous MISCLASSIFICATION, a cert shipped as Active that the SOURCE resume
// marked previously-held (expired/lapsed/"held N years"/under a Previously-Held heading). FLAG only
// (non-blocking): heuristic, and the corrected data flow is the primary guard; this is a safety net.

const PREV_HELD_HEADER_RE =
  /previously[\s-]*held|formerly[\s-]*held|(?:past|prior|expired|inactive|former)\s+certifications?/i
const INLINE_PREV_RE = /\(\s*(?:expired|lapsed|inactive|no longer\b|former\b|held\s+\d+\s+years?)[^)]*\)/i

export interface CertStatusResult {
  ok: boolean
  /** No source resume to check against, degrade OPEN (don't flag). */
  skipped: boolean
  /** Active certs that look previously-held in the source resume (likely misclassified). */
  suspicious: string[]
}

/**
 * Flag active certs that the SOURCE resume appears to mark as previously-held. Non-blocking: a true
 * positive means structureResume mis-set the status and the doc would overstate the cert as current.
 */
export function checkCertStatus(profile: Profile, sourceResumeText?: string): CertStatusResult {
  const source = (sourceResumeText ?? '').trim()
  if (!source) return { ok: true, skipped: true, suspicious: [] }

  const lower = source.toLowerCase()
  const header = PREV_HELD_HEADER_RE.exec(source)
  const prevRegionStart = header?.index ?? -1

  const suspicious: string[] = []
  for (const cert of profile.certs) {
    if (cert.status === 'previously_held') continue // correctly classified, nothing to flag
    const name = normalize(cert.name)
    if (!name) continue
    const idx = lower.indexOf(name)
    if (idx === -1) continue
    const inPrevRegion = prevRegionStart !== -1 && idx > prevRegionStart
    const inlineCue = INLINE_PREV_RE.test(source.slice(idx, idx + cert.name.length + 40))
    if (inPrevRegion || inlineCue) suspicious.push(cert.name)
  }
  return { ok: suspicious.length === 0, skipped: false, suspicious }
}

// ---- aggregate -------------------------------------------------------------------

export interface GuardrailOptions {
  bannedTerms?: string[]
  style?: StyleOptions
  atsDoc?: AtsDocModel
  /** Original uploaded resume text, grounds the shipped profile bullets/summary against it (ai-26). */
  sourceResumeText?: string
}

export interface GuardrailReport {
  ok: boolean
  noFabrication: NoFabricationResult
  bannedTerms: BannedTermsResult
  style: StyleResult
  ats: AtsResult | null
  bulletsGrounded: BulletsGroundedResult
  /** Non-blocking flag: active certs that look previously-held in the source resume. */
  certStatus: CertStatusResult
}

/** Run all guardrails and roll up a single pass/fail report. */
export function runGuardrails(
  tailored: TailoredContent,
  profile: Profile,
  options: GuardrailOptions = {},
): GuardrailReport {
  const noFabrication = checkNoFabrication(tailored, profile)
  const bannedTerms = checkBannedTerms(tailored, profile, options.bannedTerms ?? [])
  const styleText = [
    tailored.summary,
    tailored.coverLetter,
    tailored.outreach.linkedin,
    tailored.outreach.email,
    ...tailored.claims.map((c) => c.text),
  ].join('\n')
  const style = checkStyle(styleText, options.style)
  const ats = options.atsDoc ? checkAtsSafe(options.atsDoc) : null
  const bulletsGrounded = checkBulletsGrounded(profile, options.sourceResumeText)
  const certStatus = checkCertStatus(profile, options.sourceResumeText)

  // certStatus is a NON-BLOCKING flag (surfaced for review), so it is deliberately excluded from `ok`.
  const ok = noFabrication.ok && bannedTerms.ok && style.ok && (ats?.ok ?? true) && bulletsGrounded.ok
  return { ok, noFabrication, bannedTerms, style, ats, bulletsGrounded, certStatus }
}

// Deterministic guardrails, run AFTER the model and trust nothing (Engineering Plan §6).
// The no-fabrication check is the product's differentiator: every tailored claim must trace
// to a real profile fact, enforced in code, not by prompt wording. A failed check blocks or
// flags, it never ships silently.
import type { Profile, TailoredContent, Claim } from '@/lib/schemas'
import { aliasForms, canonicalize } from '@/lib/skillAliases'

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
export const GLUE_WORDS = new Set([
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

// Ordered marker pairs whose two halves each introduce a phrase, so swapping the phrases INVERTS the
// meaning: "migrated from Oracle to PostgreSQL" vs "migrated from PostgreSQL to Oracle" share an
// identical token set and identical (empty) negation key. Route 2's token-faithfulness check is a
// bag-of-words comparison, order-blind by design, so on its own it reads that inversion as a faithful
// paraphrase. These are relational constructions, not domain terms, so listing them can never launder
// a fabrication (the same reason GLUE_WORDS is safe). The markers themselves may be glue words; here
// they are used only as structural landmarks, so their glue status is irrelevant.
const DIRECTIONAL_MARKER_PAIRS: readonly (readonly [string, string])[] = [
  ['from', 'to'],
  ['before', 'after'],
  ['above', 'below'],
]
const DIRECTIONAL_MARKERS = new Set(DIRECTIONAL_MARKER_PAIRS.flat())

// Transition verbs that imply a source -> destination even WITHOUT a literal "from": "migrated X to Y"
// means X -> Y (finding F-D gap 1). Deliberately a SMALL, unambiguous set of movement/change verbs, NOT
// every verb that can precede "to": ordinary non-directional "... to ..." phrasing ("reported to the
// CFO", "attended to tickets", "contributed to the migration") must NOT read as directional, or we
// would start flagging the plain reorderings finding 3 was careful to still allow. Only consulted when
// a side has no explicit "from" (explicit from/to is matched directly).
const TRANSITION_VERBS = new Set([
  'migrated', 'migrate', 'migrating', 'moved', 'move', 'moving', 'switched', 'switch', 'switching',
  'upgraded', 'upgrade', 'upgrading', 'ported', 'porting', 'converted', 'convert', 'converting',
  'transitioned', 'transition', 'transitioning', 'downgraded', 'downgrade', 'downgrading',
])

/** Content span (non-glue tokens) from just after position `start` up to the next directional marker
 *  or the end. The phrase a marker introduces (the 'from X' span, the 'to Y' span). */
function spanFrom(tokens: string[], start: number): string[] {
  let end = tokens.length
  for (let i = start + 1; i < tokens.length; i++) {
    if (DIRECTIONAL_MARKERS.has(tokens[i] as string)) {
      end = i
      break
    }
  }
  return tokens.slice(start + 1, end).filter((w) => !GLUE_WORDS.has(w))
}

/** The content span each occurrence of `marker` introduces, in order. Generalizes to MULTIPLE clauses
 *  ("from A to B and from C to D" -> two "from" spans), which is what closes finding F-D gap 2. */
function directionalSpans(tokens: string[], marker: string): string[][] {
  const spans: string[][] = []
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === marker) spans.push(spanFrom(tokens, i))
  return spans
}

/** The single source -> destination this text expresses for the from/to relation, explicit ("from X
 *  to Y") or IMPLICIT ("migrated X to Y", source = the phrase between the transition verb and "to").
 *  Only for the SINGLE-clause case (exactly one "to"): a multi-clause "to" is left to the per-clause
 *  check below, since comparing only a first clause would wrongly reject a legitimate clause REORDER.
 *  Null when there is no such structure. The implicit form is recognized only when there is no explicit
 *  "from" AND a curated transition verb governs the "to", so plain "... to ..." is never misread as
 *  directional. Normalizing both sides through this also catches a claim that DROPS "from" while
 *  inverting ("migrated PostgreSQL to Oracle" against a fact's "from Oracle to PostgreSQL"). */
function fromToDirection(tokens: string[]): { source: string[]; dest: string[] } | null {
  if (tokens.filter((t) => t === 'to').length !== 1) return null
  const toIdx = tokens.indexOf('to')
  const dest = spanFrom(tokens, toIdx)
  if (dest.length === 0) return null
  const fromCount = tokens.filter((t) => t === 'from').length
  if (fromCount === 1) {
    const source = spanFrom(tokens, tokens.indexOf('from'))
    return source.length ? { source, dest } : null
  }
  if (fromCount > 1) return null // irregular; leave to the per-clause check
  let verbIdx = -1
  for (let i = 0; i < toIdx; i++) if (TRANSITION_VERBS.has(tokens[i] as string)) { verbIdx = i; break }
  if (verbIdx < 0) return null
  const source = tokens.slice(verbIdx + 1, toIdx).filter((w) => !GLUE_WORDS.has(w) && !TRANSITION_VERBS.has(w))
  return source.length ? { source, dest } : null
}

/** True unless a directional relationship present in BOTH fact and claim binds DIFFERENT phrases to the
 *  same role, i.e. an inverted "from X to Y". Two complementary checks:
 *   (A) For each explicit marker pair, compare the FULL set of clauses (every occurrence, not just the
 *       first): the k-th m1-span zips with the k-th m2-span into a clause, and every CLAIM clause must
 *       be a genuine FACT clause (same direction). This catches a swap in ANY clause of a multi-clause
 *       fact, while still allowing clause reordering and a faithful partial restatement (claim clauses
 *       are a subset of the fact's). (finding F-D gap 2)
 *   (B) The single from/to direction (explicit OR implicit "migrated X to Y") must match when both
 *       sides express one. This catches the marker-less case and the mixed case where one side drops
 *       "from" while inverting. (finding F-D gap 1)
 *  A relationship absent on a side is ignored, so a non-directional reorder (an em dash rewritten as
 *  "including", a re-ordered list) falls straight through to the unchanged bag-of-words logic. */
function directionalRolesAgree(claimTokens: string[], factTokens: string[]): boolean {
  const canon = (s: string[]): string => [...s].sort().join(' ')
  const clausesOf = (a: string[][], b: string[][]): string[] =>
    a.map((s, i) => `${canon(s)} => ${canon(b[i] as string[])}`)

  // (A) explicit pairs, per-clause; claim clauses must be a subset of the fact's clauses.
  for (const [m1, m2] of DIRECTIONAL_MARKER_PAIRS) {
    const c1 = directionalSpans(claimTokens, m1)
    const c2 = directionalSpans(claimTokens, m2)
    const f1 = directionalSpans(factTokens, m1)
    const f2 = directionalSpans(factTokens, m2)
    if (!c1.length || !c2.length || !f1.length || !f2.length) continue
    if (c1.length !== c2.length || f1.length !== f2.length) continue // irregular pairing; (B) still guards
    const remaining = clausesOf(f1, f2)
    for (const cl of clausesOf(c1, c2)) {
      const idx = remaining.indexOf(cl)
      if (idx < 0) return false
      remaining.splice(idx, 1)
    }
  }

  // (B) single from/to direction, explicit or implicit.
  const cd = fromToDirection(claimTokens)
  const fd = fromToDirection(factTokens)
  if (cd && fd && (canon(cd.source) !== canon(fd.source) || canon(cd.dest) !== canon(fd.dest))) return false

  return true
}

/** True when a single fact carries any negation/polarity word: the fact asserts an absence, not a
 *  capability. Whole-fact scope (not term-proximity) on purpose: it is the conservative, fail-CLOSED
 *  reading. A mixed "no Java but expert Kubernetes" fact is treated as negated (a safe over-block); we
 *  never let a fact the profile explicitly disclaims count as grounding. */
export function factIsNegated(fact: string): boolean {
  return negationKey(new Set(wordTokens(fact))) !== ''
}

/** Grounded iff `term` appears in at least one NON-negated fact. Grounding against the flattened
 *  profile text (the old approach) let a disclaimer ground the very skill it denies: "No hands-on
 *  Kubernetes experience" wrongly grounded "Kubernetes". Checking fact-by-fact and skipping any negated
 *  fact fixes that while keeping every real, positively-stated skill grounded. Fails CLOSED: when in
 *  doubt a term reads as ungrounded (over-blocks), never as silently grounded. Alias-aware
 *  (mentionsAny) so "K8s" in the profile grounds a tailored "Kubernetes"; the alias net composes with
 *  negation because each alias form is still only tried against the NON-negated facts. */
export function groundedInFacts(facts: string[], term: string): boolean {
  return facts.some((fact) => !factIsNegated(fact) && mentionsAny(fact, term))
}

/** The distinct skill forms a tailored skill surfaces. A plain skill is one form. The alias-pairing
 *  shape "JobForm (FactForm)" (e.g. "Kubernetes (K8s)") surfaces TWO forms, so both can be verified.
 *  Only a single trailing parenthetical is treated this way; any other shape stays a single form. */
export function surfacedForms(skill: string): string[] {
  const m = skill.match(/^(.+?)\s*\(([^()]+)\)\s*$/)
  return m ? [(m[1] ?? '').trim(), (m[2] ?? '').trim()].filter(Boolean) : [skill.trim()]
}

/**
 * A tailored skill is grounded when it traces to a real profile fact. Two routes:
 *   1. The skill AS SHIPPED (including any verbatim parenthetical) traces to a fact via the existing
 *      alias-aware check. Unchanged for plain skills and for a parenthetical that is itself a fact
 *      (e.g. a cert "Security+ (SY0-601)").
 *   2. The alias-pairing shape "JobForm (FactForm)": both surfaced forms must be CURATED ALIASES of
 *      each other (same canonical, so the parenthetical cannot smuggle in a different technology) AND
 *      the shared skill must trace to a real fact. This lets a resume surface the JD's preferred
 *      spelling for an external ATS ("Kubernetes (K8s)") when the fact only says "K8s", using the exact
 *      same curated, shadow-mode-verified alias table already trusted for scoring and grounding.
 * A surfaced form NOT backed by a verified alias of a real fact is still ungrounded ("Kubernetes
 * (Docker)" is rejected: the two forms are different technologies, not curated aliases).
 */
function skillGrounded(facts: string[], skill: string): boolean {
  if (groundedInFacts(facts, skill)) return true
  const forms = surfacedForms(skill)
  if (forms.length < 2) return false
  const canon = canonicalize(forms[0] as string)
  if (!forms.every((f) => canonicalize(f) === canon)) return false
  return forms.some((f) => groundedInFacts(facts, f))
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
  const factTokens = wordTokens(fact)
  const factSet = new Set(factTokens)
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
  // parenthetical). Because this is a bag-of-words comparison it is order-blind, so first reject a
  // directional inversion ("from X to Y" -> "from Y to X"): a relational pair present on both sides
  // must bind the SAME phrase to each role. Non-directional reorders are unaffected (no pair matches).
  if (!directionalRolesAgree(claimTokens, factTokens)) return false

  // Anti-fabrication: every substantive (non-glue) claim token must come from the fact. Then it must
  // be substantial, and carry the same negation polarity (no silent meaning flip).
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

// Each metric-context pattern is tagged with the KIND of quantity it captures, so grounding can compare
// a claim's metric against profile metrics of the SAME kind only (finding 9). Bare-number membership
// was unit-blind: an invented "$40M" grounded off an unrelated "40 VMs" count that merely shared the
// digits. The combined METRIC_RE is built from these same branches, so phrase matching and kind-tagging
// share one source of truth (no parallel classifier). Digit runs stay bounded ({0,24}); see below.
type MetricKind = 'percent' | 'dollar' | 'team' | 'count'
const METRIC_BRANCHES: readonly { kind: MetricKind; re: string }[] = [
  { kind: 'percent', re: String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\s*%` }, // 40%, 1,200%
  { kind: 'percent', re: String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\s*percent\b` }, // 40 percent
  { kind: 'dollar', re: String.raw`\$\s?\d[\d,]{0,24}(?:\.\d{0,12})?(?:\s*(?:k|m|b|million|billion|thousand))?` }, // $2M, $500,000
  { kind: 'team', re: String.raw`team\s+of\s+\d[\d,]{0,24}` }, // team of 12
  // a count bound to a candidate-scope unit (years intentionally excluded)
  { kind: 'count', re: String.raw`\d[\d,]{0,24}(?:\.\d{0,12})?\+?\s*(?:people|engineers?|staff|employees|reports?|clients?|customers?|users?|servers?|vms?|sites?|branches|stores?|locations?|projects?|deployments?|tickets?|incidents?|endpoints?|devices?|nodes?|clusters?)\b` },
]

// Digit runs are bounded (`{0,24}` not `*`): a real metric never has 25+ digit/comma chars, and the
// unbounded `[\d,]*` + optional groups backtrack catastrophically on a long numeric paste, measured
// ~tens of seconds of event-loop block on a 100k-char digit string. The bound makes matching linear
// without dropping any legitimate quantity (ReDoS hardening). Preserved exactly through the refactor.
const METRIC_RE = new RegExp(METRIC_BRANCHES.map((b) => b.re).join('|'), 'gi')

/** Pull comma-stripped numeric tokens out of a string (e.g. "$500,000" -> ["500000"]). Digit run
 *  bounded ({0,24}) for the same ReDoS reason as METRIC_RE. */
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]{0,24}(?:\.\d{0,12})?/g) ?? []).map((n) => n.replace(/,/g, ''))
}

// Dollar shorthand multipliers. Longest spellings first so "million" is not consumed as a bare "m".
const DOLLAR_SUFFIX = /(million|billion|thousand|k|m|b)\s*$/i
const DOLLAR_MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }

interface Metric {
  kind: MetricKind
  value: number
  unit: string
}

/** Classify one METRIC_RE-matched phrase into (kind, canonical numeric value, unit); null when no branch
 *  fully matches or there is no number. Kind is decided by branch precedence (same order as the combined
 *  regex), so a phrase is tagged with the branch that produced it. VALUE is normalized so representation
 *  differences never cause a false block: "$1.5M", "$1,500,000", and "$1.5 million" all become 1500000. */
function classifyMetric(phrase: string): Metric | null {
  const p = phrase.trim()
  const branch = METRIC_BRANCHES.find((b) => new RegExp(`^(?:${b.re})$`, 'i').test(p))
  if (!branch) return null
  const numMatch = p.match(/\d[\d,]{0,24}(?:\.\d{0,12})?/)
  if (!numMatch) return null
  let value = Number(numMatch[0].replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  let unit = ''
  if (branch.kind === 'dollar') {
    const suf = p.toLowerCase().match(DOLLAR_SUFFIX)
    const mult = suf ? DOLLAR_MULT[suf[1] as string] : undefined
    if (mult) value *= mult
  } else if (branch.kind === 'count') {
    // The trailing unit word, singularized so "40 vms" and "40 vm" compare equal.
    unit = (p.toLowerCase().match(/([a-z]+)\s*$/)?.[1] ?? '').replace(/s$/, '')
  }
  return { kind: branch.kind, value, unit }
}

/** Canonical comparison key: kind + normalized value, plus the unit for counts (so "40 servers" never
 *  grounds "40 users"). A dollar figure and a same-numbered count get different keys, closing finding 9. */
function metricKey(m: Metric): string {
  return m.kind === 'count' ? `count:${m.unit}:${m.value}` : `${m.kind}:${m.value}`
}

/** Every metric present in a text, as canonical keys. */
function metricsIn(text: string): Set<string> {
  const keys = new Set<string>()
  for (const phrase of text.match(METRIC_RE) ?? []) {
    const m = classifyMetric(phrase)
    if (m) keys.add(metricKey(m))
  }
  return keys
}

/** Metric phrases in the prose whose (kind, normalized value) is absent from the profile facts. Compares
 *  within a metric KIND and by canonical VALUE: an invented "$40M" is NOT grounded by an unrelated
 *  "40 VMs" count, and a real "$1,500,000" IS grounded by a fact's "$1.5M" shorthand.
 *
 *  Each prose field and each profile fact is scanned SEPARATELY, never a single joined string
 *  (finding F-C, the metric-side twin of finding 12). METRIC_RE's `\s*`/`\s+` match a newline, so
 *  joining fields let a phrase form across a boundary: a field ending "...team of" + a field starting
 *  "12 engineers..." phantom-matched "team of 12", and a bare trailing number + a next field starting
 *  with a unit word fabricated a grounded count, neither present in any single field. Per-field scanning
 *  means a metric must appear COMPLETE within one field to count (prose side) or ground (fact side). */
function ungroundedMetricsIn(proseFields: string[], factTexts: string[]): string[] {
  const profileKeys = new Set<string>()
  for (const fact of factTexts) for (const k of metricsIn(fact)) profileKeys.add(k)
  const flagged: string[] = []
  for (const field of proseFields) {
    for (const phrase of field.match(METRIC_RE) ?? []) {
      const m = classifyMetric(phrase)
      if (m && !profileKeys.has(metricKey(m))) flagged.push(phrase.trim())
    }
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
  // Accept a prebuilt index so runGuardrails can share ONE indexFacts() build across the checks (and
  // downstream analytics) instead of each rebuilding it. Defaults to building its own for direct callers.
  index: FactIndex = indexFacts(profile),
): NoFabricationResult {
  const unverifiable = tailored.claims.filter((c) => !traceable(c, index))
  const ungroundedSkills = tailored.skills.filter((s) => !skillGrounded(index.texts, s))
  // The outreach messages are fact-grounded prose too, so hold them to the same no-invented-metric bar.
  // Pass each field separately (never one joined blob) so a metric can't form across a field boundary,
  // and ground against each fact separately (index.texts) for the same reason (finding F-C).
  const ungroundedMetrics = ungroundedMetricsIn(
    [tailored.summary, tailored.coverLetter, tailored.outreach.linkedin, tailored.outreach.email],
    index.texts,
  )
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
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Token boundary that tolerates the TERM's own non-word edge chars (C++, C#, F#, .NET, Node.js):
  // match unless flanked by a WORD char (which would make it part of a larger identifier, e.g. "java"
  // inside "javascript"). `\b` fails when an edge char is non-word (+/#/.), which false-blocked real,
  // listed skills. Negative word-char lookarounds keep the whole-token intent without that bug.
  //
  // The SAME boundaries apply to multi-word terms. The earlier raw `includes()` fallback for phrases
  // had NO boundary protection, so a phrase matched INSIDE a longer, different term: the alias form
  // "sql server" matched "mysql server" ("my" + "sql server"), letting a MySQL-only profile ground a
  // tailored "SQL Server" claim, and "virtual machine" matched "virtual machinery". Anchoring both
  // ends of the whole phrase closes that class for every multi-word form the alias table fans out to.
  //
  // Dotted-identifier guard (finding 10): normalize() preserves periods, so a bare `(?!\w)` boundary
  // let a short alias match a COMPONENT of a dotted product name, "js" inside "vue.js" / "node.js" /
  // "express.js" satisfied a JavaScript requirement by accidental collision. So also reject a match
  // whose immediate neighbor forms a dotted compound: a "." right BEFORE it ("vue.js" -> the "js" is a
  // component, not standalone) or a ".<word>" right AFTER it ("js.foo"). This is boundary-generic, not
  // hardcoded to "js", so any short alias is protected. A term that legitimately CONTAINS or STARTS
  // with a dot (Node.js, .NET) still matches as itself: the lookbehind/ahead only inspect the chars
  // OUTSIDE the term, and a sentence-final "JS." still matches ("." not followed by a word char).
  return new RegExp(`(?<![\\w.])${escaped}(?!\\w)(?!\\.\\w)`).test(haystack)
}

/** Alias-aware mentions: true when `term` OR any curated canonical-equivalent form (K8s <-> Kubernetes,
 *  IaC <-> Infrastructure as Code, ...) appears in `haystack`. Purely additive over mentions(), a term
 *  with no alias behaves identically. Deterministic table lookup, never a fuzzy/similarity match. */
export function mentionsAny(haystack: string, term: string): boolean {
  return aliasForms(term).some((form) => mentions(haystack, form))
}

export interface BannedTermsResult {
  ok: boolean
  violations: string[]
}

/**
 * Banned terms: a sensitive term (e.g. "Kubernetes") may appear in the tailored output only
 * if it is present somewhere in the profile facts. Caller supplies the watch list.
 */
/** The profile facts that assert a genuine CAPABILITY, skills, certs, role bullets, and summary, with
 *  company names, job titles, and education institution/school entries excluded. This is finding 11's
 *  field-exclusion rule (working AT "Oracle Health" is not Oracle experience), shared here so
 *  scoring (groundSignals.creditBearingFacts) and banned-term grounding use ONE definition. Excluded
 *  entries are dropped by their stable indexFacts() ids; the kept values are normalized like
 *  index.texts. Callers that need the FULL corpus (e.g. checkNoFabrication's claim tracing) keep using
 *  index.texts and are unaffected. */
export function capabilityFactTexts(index: FactIndex): string[] {
  const isCapability = (id: string): boolean =>
    !/:title$/.test(id) && !/:company$/.test(id) && !id.startsWith('edu:')
  return [...index.byId.entries()].filter(([id]) => isCapability(id)).map(([, text]) => normalize(text))
}

export function checkBannedTerms(
  tailored: TailoredContent,
  profile: Profile,
  bannedTerms: string[],
  index: FactIndex = indexFacts(profile),
): BannedTermsResult {
  // Ground the exception check against CAPABILITY facts only (finding F-F): a banned term is licensed
  // only by a real skill/cert/bullet/summary assertion, NOT by an incidental company name or job title.
  // Employment at a company literally named "Oracle Health" must not let a banned "Oracle" ship. This
  // reuses finding 11's field-exclusion rule; checkNoFabrication's claim tracing still uses the full
  // corpus (a tailored claim genuinely naming an employer is a real, groundable fact) and is unchanged.
  const facts = capabilityFactTexts(index)
  // Check each field SEPARATELY, never a single joined blob (finding 12). Joining with a space let a
  // multi-word banned term form spuriously across a field boundary: a summary ending "...Windows" plus
  // a skill "Server administration" concatenated to "...Windows Server administration...", tripping a
  // banned "Windows Server" that exists in no single field. Per-field matching means a multi-word term
  // must appear COMPLETE within one field to count; same-field detection is unchanged.
  const fields = [
    tailored.summary,
    tailored.coverLetter,
    tailored.outreach.linkedin,
    tailored.outreach.email,
    ...tailored.skills,
    ...tailored.claims.map((c) => c.text),
  ].map(normalize)
  // Detection and grounding must be alias-consistent: use mentionsAny() on BOTH halves so a banned
  // term shipping only as a curated alias (output says "K8s", banned term is "Kubernetes") is DETECTED
  // the same way it is grounded. With plain mentions() on detection, the alias form evaded the check
  // entirely (the filter never fired), regardless of grounding. Ground against NON-negated facts only:
  // a term the profile explicitly disclaims ("No Kubernetes experience") must not license shipping it.
  const violations = bannedTerms.filter(
    (term) => fields.some((field) => mentionsAny(field, term)) && !groundedInFacts(facts, term),
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
    // One shipped bullet vs the raw source resume: each is a single contiguous string, so wrapping
    // in singleton arrays preserves the prior behavior (the array API is for the field-join guard).
    ungroundedMetrics.push(...ungroundedMetricsIn([text], [source]))
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
  /** Certs that do not appear in the source resume AT ALL, possibly invented during structuring. */
  notFound: string[]
}

/**
 * Two source-grounded cert checks, both NON-BLOCKING (profiles can legitimately be edited after the
 * original upload, e.g. a cert earned since, so hard-blocking would produce real false positives):
 *   - notFound: the cert name traces to NOTHING in the source resume, which can mean structureResume
 *     invented it wholesale (not just misclassified it). Uses mentions() so a dash/punctuation
 *     difference alone (profile "AZ-104" -> "az 104" vs a raw "az-104" in the source) never causes a
 *     false "not found", the earlier raw lower.indexOf did.
 *   - suspicious: an ACTIVE cert the source appears to mark as previously-held (misclassification), so
 *     the doc would overstate it as current.
 */
export function checkCertStatus(profile: Profile, sourceResumeText?: string): CertStatusResult {
  const source = (sourceResumeText ?? '').trim()
  if (!source) return { ok: true, skipped: true, suspicious: [], notFound: [] }

  const lower = source.toLowerCase()
  const srcNorm = normalize(source) // dash/space-consistent with normalize(cert.name), for findability
  const header = PREV_HELD_HEADER_RE.exec(source)
  const prevRegionStart = header?.index ?? -1

  const suspicious: string[] = []
  const notFound: string[] = []
  for (const cert of profile.certs) {
    const name = normalize(cert.name)
    if (!name) continue
    // Findability FIRST (for every cert, active or previously-held): a cert that traces to nothing in
    // the source may have been invented during structuring, a distinct failure from misclassification.
    if (!mentions(srcNorm, cert.name)) {
      notFound.push(cert.name)
      continue
    }
    if (cert.status === 'previously_held') continue // correctly classified, nothing to flag as suspicious
    const idx = lower.indexOf(name)
    if (idx === -1) continue // found via normalize but not in the raw lower (dash diff), can't position-check
    const inPrevRegion = prevRegionStart !== -1 && idx > prevRegionStart
    const inlineCue = INLINE_PREV_RE.test(source.slice(idx, idx + cert.name.length + 40))
    if (inPrevRegion || inlineCue) suspicious.push(cert.name)
  }
  return { ok: suspicious.length === 0 && notFound.length === 0, skipped: false, suspicious, notFound }
}

// ---- education grounding (defense-in-depth) --------------------------------------
// Same rationale as checkBulletsGrounded: the structured education entries are LLM-derived, so ground
// each against the ORIGINAL resume text by content-word overlap. NON-BLOCKING (rephrasing/abbreviation
// is legitimate, e.g. "BS" vs "Bachelor of Science"); low-overlap entries are flagged for review only.

export interface EducationGroundedResult {
  /** Always true, this check never blocks; it only surfaces entries for review. */
  ok: boolean
  /** No source resume to check against, degrade OPEN (don't flag). */
  skipped: boolean
  /** Education entries whose content words barely overlap the source resume (surfaced for review). */
  flagged: { text: string; overlap: number }[]
}

/**
 * Ground each structured education entry against the ORIGINAL resume text. Builds the entry text the
 * same way indexFacts does ([degree, field, school]) and reuses the bullet overlap helpers. Skips
 * (degrades open) with no source text; never blocks.
 */
export function checkEducationGrounded(profile: Profile, sourceResumeText?: string): EducationGroundedResult {
  const source = (sourceResumeText ?? '').trim()
  if (!source) return { ok: true, skipped: true, flagged: [] }

  const sourceTokens = contentTokens(source)
  const flagged: { text: string; overlap: number }[] = []
  for (const e of profile.education) {
    const text = [e.degree, e.field, e.school].filter(Boolean).join(' ')
    if (!text.trim()) continue
    const overlap = sourceOverlap(text, sourceTokens)
    if (overlap < OVERLAP_FLAG_THRESHOLD) flagged.push({ text, overlap: Math.round(overlap * 100) / 100 })
  }
  return { ok: true, skipped: false, flagged }
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
  /** Non-blocking flag: active certs that look previously-held, or certs absent from the source. */
  certStatus: CertStatusResult
  /** Non-blocking flag: education entries with low overlap against the source resume. */
  educationGrounded: EducationGroundedResult
  /** The normalized source-fact texts the checks ran against. Exposed so downstream consumers (e.g.
   *  block analytics) reuse this single build instead of re-indexing the profile. Optional so partial
   *  report literals in tests stay valid; always populated by runGuardrails. */
  factTexts?: string[]
}

/** Run all guardrails and roll up a single pass/fail report. */
export function runGuardrails(
  tailored: TailoredContent,
  profile: Profile,
  options: GuardrailOptions = {},
): GuardrailReport {
  // Build the fact index ONCE and share it with the fact-based checks (and expose its texts on the
  // report), instead of each check re-indexing the same profile.
  const index = indexFacts(profile)
  const noFabrication = checkNoFabrication(tailored, profile, index)
  const bannedTerms = checkBannedTerms(tailored, profile, options.bannedTerms ?? [], index)
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
  const educationGrounded = checkEducationGrounded(profile, options.sourceResumeText)

  // certStatus and educationGrounded are NON-BLOCKING flags (surfaced for review), so they are
  // deliberately excluded from `ok`.
  const ok = noFabrication.ok && bannedTerms.ok && style.ok && (ats?.ok ?? true) && bulletsGrounded.ok
  return { ok, noFabrication, bannedTerms, style, ats, bulletsGrounded, certStatus, educationGrounded, factTexts: index.texts }
}

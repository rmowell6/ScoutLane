import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { coverage, assessFit, type FitInput } from '@/lib/fit/fitScore'
import { skillCoverage, humanizeNote, isUnassessed } from '@/lib/fit/fitPresent'
import { groundCandidateSignals, groundJobSignals } from '@/lib/fit/groundSignals'
import { assembleFitInput, type FitSignals } from '@/lib/fit/fitSignals'
import { checkBannedTerms, checkNoFabrication, indexFacts, mentionsAny, normalize, traceable } from '@/lib/guardrails'
import { allowedAliasPairings } from '@/lib/services/tailorResume'
import * as skillAliases from '@/lib/skillAliases'
import type { JobReqs, Profile, TailoredContent } from '@/lib/schemas'

// ============================================================================================
// Trust-boundary consistency harness.
//
// The no-fabrication boundary answers "does the candidate have X" through THREE independent
// implementations:
//   A. canonical token equality: fitScore.coverage() / fitPresent.skillCoverage()
//   B. alias-fanned text matching: guardrails grounding (checkNoFabrication / checkBannedTerms
//      via mentions/mentionsAny)
//   C. flattened-text signal grounding: groundSignals.groundCandidateSignals()
// A holistic audit found 13 places where two of these (or their composition with the tailor
// prompt / presentation copy) disagree. This file runs each finding's EXACT triggering input
// through the implementations involved and asserts the DESIRED, consistent behavior.
//
// Convention: a finding that is still OPEN is written as `test.fails(...)` (vitest inverts it:
// the suite stays green while the disagreement exists). When a fix lands, that test.fails starts
// FAILING, which forces whoever fixed it to flip the case to a normal `test(...)`. The harness
// therefore doubles as a per-finding status board that cannot silently go stale:
//   test(...)        = fixed and verified consistent
//   test.fails(...)  = known-open disagreement (the body states the desired behavior)
// ============================================================================================

const mkProfile = (over: Partial<Profile> = {}): Profile => ({
  name: 'Ada Lovelace',
  summary: 'Infrastructure engineer.',
  skills: ['Azure'],
  roles: [{ company: 'Analytical Engines', title: 'Platform Engineer', startDate: '2020', endDate: null, bullets: ['Migrated 40 VMs to Azure'] }],
  certs: [],
  education: [],
  ...over,
})

const mkTailored = (over: Partial<TailoredContent> = {}): TailoredContent => ({
  summary: 'Engineer.',
  skills: [],
  claims: [],
  coverLetter: 'Body.',
  outreach: { linkedin: 'Note.', email: 'Hello. Best, Ada' },
  ...over,
})

const mkSignals = (over: Partial<FitSignals> = {}): FitSignals => ({
  roleTypeMatch: 'best',
  mustHaveSkills: [],
  preferredSkills: [],
  candidateSkills: [],
  adjacentSkills: [],
  seniorityMatch: 'exact',
  compTopUsd: null,
  employerType: 'direct',
  location: 'remote_us',
  locationFlags: { onCall: false, travelModerate: false, travelHeavy: false },
  vertical: 'match',
  engagementType: 'unspecified',
  sponsorshipAvailable: 'unspecified',
  requiredCerts: [],
  heldCerts: [],
  adjacentCerts: [],
  hardGaps: [],
  flags: { expired: false, unconfirmedLive: false, defenseAdjacent: false, heavyTravelOrPresales: false },
  evidence: { roleTypeMatch: '', seniorityMatch: '', location: '', employerType: '', vertical: '', engagementType: '', sponsorshipAvailable: '' },
  ...over,
})

// The three implementations, probed only through public surfaces.
const eqMatches = (required: string, held: string): boolean =>
  coverage([required], [held], [], 80).full === 1 && skillCoverage([required], [held])[0]?.status === 'match'
const groundingAccepts = (profile: Profile, skill: string): boolean =>
  checkNoFabrication(mkTailored({ skills: [skill] }), profile).ungroundedSkills.length === 0
const signalsKeep = (profile: Profile, token: string): boolean =>
  groundCandidateSignals(mkSignals({ candidateSkills: [token] }), profile).signals.candidateSkills.includes(token)

// -------------------------------------------------------------------------------------------
// Baseline: cases where all three implementations MUST already agree (harness sanity checks).
// -------------------------------------------------------------------------------------------
describe('baseline tri-implementation agreement (must always pass)', () => {
  test('curated alias pair (kubernetes / k8s): all three say YES', () => {
    const profile = mkProfile({ skills: ['K8s'] })
    expect(eqMatches('kubernetes', 'k8s')).toBe(true)
    expect(groundingAccepts(profile, 'Kubernetes')).toBe(true)
    expect(signalsKeep(profile, 'Kubernetes')).toBe(true)
  })

  test('unrelated technologies (react vs angular): all three say NO', () => {
    const profile = mkProfile({ skills: ['React'] })
    expect(eqMatches('angular', 'react')).toBe(false)
    expect(groundingAccepts(profile, 'Angular')).toBe(false)
    expect(signalsKeep(profile, 'Angular')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 1 (High): multi-word alias forms match as unanchored substrings, so a MySQL-only
// profile grounds "SQL Server". Implementations: A (eq) vs B (grounding). Desired: B agrees
// with A that this is NOT held.
// -------------------------------------------------------------------------------------------
describe('finding 1: substring grounding vs canonical equality (sql server / mysql server)', () => {
  const mysqlOnly = mkProfile({ skills: ['MySQL Server'], roles: [{ company: 'Co', title: 'DBA', startDate: '2020', endDate: null, bullets: ['Administered MySQL Server databases'] }] })

  test('implementation A (coverage/skillCoverage) correctly says NOT held', () => {
    expect(eqMatches('sql server', 'mysql server')).toBe(false)
  })

  test('FIXED: grounding agrees a MySQL-only profile does NOT hold "SQL Server"', () => {
    expect(groundingAccepts(mysqlOnly, 'SQL Server')).toBe(false)
    expect(groundingAccepts(mysqlOnly, 'MSSQL')).toBe(false)
    expect(groundingAccepts(mysqlOnly, 'SQL Server (MSSQL)')).toBe(false)
  })

  test('FIXED (same class): "virtual machine" does not ground from "virtual machinery"', () => {
    const p = mkProfile({ skills: [], roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Maintained the virtual machinery lab'] }] })
    expect(groundingAccepts(p, 'VMs')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 2 (Med-high): groundCandidateSignals grounds against flattened text with no negation
// guard; guardrails grounding skips negated facts. Implementations: B vs C. Desired: C agrees
// with B that a disclaimed skill is not held.
// -------------------------------------------------------------------------------------------
describe('finding 2: negation guard present in guardrails, absent in groundCandidateSignals', () => {
  const disclaimed = mkProfile({
    summary: 'No hands-on Kubernetes experience yet, focused on Docker.',
    skills: ['Docker'],
    roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Built container pipelines'] }],
  })

  test('implementation B (guardrails grounding) correctly refuses the disclaimed skill', () => {
    expect(groundingAccepts(disclaimed, 'Kubernetes')).toBe(false)
  })

  test('FIXED: groundCandidateSignals agrees and DROPS the disclaimed candidate skill', () => {
    expect(signalsKeep(disclaimed, 'Kubernetes')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 3 (Medium): isFaithfulRestatement is order-blind; a from/to inversion with the same
// token set passes traceable(). Desired: the inverted claim is rejected.
// -------------------------------------------------------------------------------------------
describe('finding 3: direction-inverting reorder accepted as a faithful restatement', () => {
  const profile = mkProfile({ roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Led migration from Oracle to PostgreSQL'] }] })
  const index = indexFacts(profile)

  test('the faithful same-direction claim is accepted (must keep passing after any fix)', () => {
    expect(traceable({ text: 'Led migration from Oracle to PostgreSQL', factId: 'role:0:bullet:0' }, index)).toBe(true)
  })

  test('FIXED: the from/to INVERTED claim must be rejected', () => {
    expect(traceable({ text: 'Led migration from PostgreSQL to Oracle', factId: 'role:0:bullet:0' }, index)).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 4 (Medium): checkBannedTerms detection uses alias-blind mentions() while its grounding
// half is alias-aware. Desired: a banned term shipping only as its curated alias is detected.
// -------------------------------------------------------------------------------------------
describe('finding 4: banned-term detection alias-blind vs alias-aware grounding', () => {
  const noK8s = mkProfile({ skills: ['Azure'] })
  const aliasOnlyOutput = mkTailored({ summary: 'K8s operations engineer.' })

  test('mentionsAny (the grounding primitive) DOES see the alias in the same text', () => {
    expect(mentionsAny(normalize('K8s operations engineer.'), 'Kubernetes')).toBe(true)
  })

  test('grounding half is alias-aware: a k8s-holding profile licenses the term (agreed half)', () => {
    const hasK8s = mkProfile({ skills: ['K8s'] })
    const out = mkTailored({ summary: 'Kubernetes operations engineer.' })
    expect(checkBannedTerms(out, hasK8s, ['Kubernetes']).violations).toEqual([])
  })

  test('FIXED: output containing ONLY the alias form must still trip the banned term', () => {
    expect(checkBannedTerms(aliasOnlyOutput, noK8s, ['Kubernetes']).violations).toContain('Kubernetes')
  })
})

// -------------------------------------------------------------------------------------------
// Finding 5 (Medium): the tailor prompt invited "well-known equivalent" pairings by the model's own
// judgment, but the model cannot see the curated table, so a famous-but-uncurated equivalent
// (TypeScript/TS) was sometimes attempted and hard-blocked, nondeterministically. Guardrail side
// (fail-closed, correct) is pinned as a normal test. The fix computes the exact closed set of
// pairings the guardrail accepts for THIS packet and hands only that to the model, so the option
// space equals the acceptance set: the judgment wording is gone and a disallowed pairing is never
// even offered (deterministic), while a curated one still surfaces.
// -------------------------------------------------------------------------------------------
describe('finding 5: tailor prompt allowance vs actual alias-table boundary', () => {
  test('guardrail boundary: "TypeScript (TS)" is rejected while "Kubernetes (K8s)" is accepted', () => {
    const tsProfile = mkProfile({ skills: ['TypeScript'] })
    expect(groundingAccepts(tsProfile, 'TypeScript (TS)')).toBe(false)
    const k8sProfile = mkProfile({ skills: ['K8s'] })
    expect(groundingAccepts(k8sProfile, 'Kubernetes (K8s)')).toBe(true)
  })

  test('FIXED: permitted pairings are computed from the curated table, not the model\'s "well-known" judgment', () => {
    // The judgment-based wording that invited uncurated pairings is gone from the prompt: the model is
    // handed a closed, table-derived list instead of being asked to recognize equivalents itself.
    const src = readFileSync('lib/services/tailorResume.ts', 'utf8')
    expect(/well-known|recognized standard equivalent/i.test(src)).toBe(false)
    // A famous-but-UNCURATED pairing (TS is deliberately excluded from the table) is never offered, no
    // matter how the JD phrases it, so the same input can no longer be nondeterministically blocked.
    const tsJob = { title: 'Eng', company: 'Co', mustHave: ['TypeScript', 'TS'], niceToHave: [] } as unknown as JobReqs
    expect(allowedAliasPairings(mkProfile({ skills: ['TypeScript'] }), tsJob)).toEqual([])
    // A curated pairing (K8s <-> Kubernetes) still surfaces for external ATS keyword matching.
    const k8sJob = { title: 'Eng', company: 'Co', mustHave: ['Kubernetes'], niceToHave: [] } as unknown as JobReqs
    expect(allowedAliasPairings(mkProfile({ skills: ['K8s'] }), k8sJob)).toContain('Kubernetes (K8s)')
  })
})

// -------------------------------------------------------------------------------------------
// Finding 6 (Medium): the fit score depends on the alias table (coverage -> canonicalize) but
// nothing versions that dependency. Desired: skillAliases exports a version marker that changes
// with the table, so stored scores are attributable.
// -------------------------------------------------------------------------------------------
describe('finding 6: alias-table version coupling for score reproducibility', () => {
  test('FIXED: skillAliases exports ALIAS_TABLE_VERSION (content-addressed, changes with the table)', () => {
    expect('ALIAS_TABLE_VERSION' in skillAliases).toBe(true)
  })

  test('FIXED (F-E): assessFit STAMPS the current ALIAS_TABLE_VERSION on a real score result', () => {
    // The export existing is not enough: the score must actually carry the version so a table refresh
    // is attributable. A real assessFit result must echo skillAliases.ALIAS_TABLE_VERSION.
    const result = assessFit(assembleFitInput(mkSignals(), undefined, { title: 'Eng', company: 'Co', mustHave: [], niceToHave: [] }))
    expect(result.aliasTableVersion).toBe(skillAliases.ALIAS_TABLE_VERSION)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 7 (Med-low): groundJobSignals dropping ALL must-haves routes coverage to
// neutralIfEmpty=80, which can RAISE the score. Desired: grounding never raises skillsCoverage.
// -------------------------------------------------------------------------------------------
describe('finding 7: drop-all JD must-haves inflates skillsCoverage via the neutral fallback', () => {
  const jdText = 'We need container orchestration and infrastructure automation experience.'
  const signals = mkSignals({ mustHaveSkills: ['kubernetes', 'terraform'], candidateSkills: [] })
  const jobReqs = { title: 'Eng', company: 'Co', mustHave: [], niceToHave: [] } as unknown as JobReqs
  const dimScore = (s: FitSignals): number =>
    assessFit(assembleFitInput(s, undefined, jobReqs)).dimensions.find((d) => d.key === 'skillsCoverage')!.score

  test('FIXED: grounding must not raise the skillsCoverage score by emptying the list', () => {
    const before = dimScore(signals) // candidate holds neither must-have -> 0
    const grounded = groundJobSignals(signals, jdText).signals // paraphrased tokens -> all dropped
    expect(dimScore(grounded)).toBeLessThanOrEqual(before)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 8 (Med-low): with no candidate preference, the JD's own comp becomes "your target"
// (ratio 1.0, score 92). Desired: no preference -> the comp dimension takes a neutral path.
// -------------------------------------------------------------------------------------------
describe('finding 8: JD comp used as "your target" when no preference exists', () => {
  const jobReqs = { title: 'Eng', company: 'Co', mustHave: [], niceToHave: [] } as unknown as JobReqs

  test('FIXED: comp must be neutral/unassessed when the candidate never set a target', () => {
    const input: FitInput = assembleFitInput(mkSignals({ compTopUsd: 200_000 }), undefined, jobReqs)
    const dim = assessFit(input).dimensions.find((d) => d.key === 'compAlignment')!
    expect(isUnassessed(dim)).toBe(true)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 9 (Low-med): metric grounding is unit-blind. Desired: a money metric does not ground
// against a bare count, and shorthand-equivalent money DOES ground.
// -------------------------------------------------------------------------------------------
describe('finding 9: unit-blind prose metric grounding', () => {
  const vmProfile = mkProfile() // fact: "Migrated 40 VMs to Azure"

  test('FIXED: invented "$40M" must NOT be grounded by the count "40 VMs"', () => {
    const r = checkNoFabrication(mkTailored({ coverLetter: 'I delivered $40M in savings.' }), vmProfile)
    expect(r.ungroundedMetrics.length).toBeGreaterThan(0)
  })

  test('FIXED: real "$1,500,000" must be grounded by the fact "$1.5M" (shorthand equivalence)', () => {
    const p = mkProfile({ roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Saved the company $1.5M in licensing'] }] })
    const r = checkNoFabrication(mkTailored({ coverLetter: 'I saved $1,500,000 in licensing.' }), p)
    expect(r.ungroundedMetrics).toEqual([])
  })
})

// -------------------------------------------------------------------------------------------
// Finding 10 (Low): the "js" alias matches inside every "*.js" name via the dot-tolerant token
// boundary. Implementations: A vs B. Desired: B agrees with A that Vue.js alone is not JavaScript.
// -------------------------------------------------------------------------------------------
describe('finding 10: "js" alias inside dotted identifiers (vue.js grounds JavaScript)', () => {
  const vueOnly = mkProfile({ skills: ['Vue.js'], roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Built dashboards in Vue.js'] }] })

  test('implementation A correctly says vue.js is not javascript', () => {
    expect(eqMatches('javascript', 'vue.js')).toBe(false)
  })

  test('FIXED: grounding must agree that a Vue.js-only profile does not ground "JavaScript"', () => {
    expect(groundingAccepts(vueOnly, 'JavaScript')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding F-H: the finding-10 dotted-identifier guard over-rejects. It excluded ANY term whose
// immediate neighbor was a dot, which correctly protects a short suffix ("js" in "vue.js") but
// ALSO wrongly rejected a full-length term next to a dot in a missing-space typo
// ("Docker.Kubernetes"), so a candidate who typo'd their own profile could not ground a skill
// they genuinely hold. Facts are normalized (lowercased) before matching, so capitalization is
// gone; the case-independent discriminator is length: a genuine dotted suffix is short (js/net),
// a typo-joined term is a whole word. Desired: the typo still grounds; the genuine compounds do
// not; and the finding-1 "sql server" protection (which hinges on a word char, not a dot) holds.
// -------------------------------------------------------------------------------------------
describe('finding F-H: dotted-identifier guard must not over-reject a missing-space typo', () => {
  const typoK8s = mkProfile({
    skills: ['Docker'],
    roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Ran Docker.Kubernetes in production'] }],
  })

  test('FIXED: a "Docker.Kubernetes" typo still grounds the standalone term "Kubernetes"', () => {
    expect(mentionsAny('ran docker.kubernetes in production', 'Kubernetes')).toBe(true)
    expect(groundingAccepts(typoK8s, 'Kubernetes')).toBe(true)
  })

  test('REGRESSION: genuine dotted compounds still do NOT match their bare short component', () => {
    expect(mentionsAny('built dashboards in vue.js', 'JS')).toBe(false)
    expect(mentionsAny('backend services on node.js', 'JS')).toBe(false)
    expect(mentionsAny('shipped an asp.net api', 'NET')).toBe(false)
  })

  test('REGRESSION: finding-1 "sql server" still does not match inside "mysql server"', () => {
    expect(mentionsAny('administered mysql server databases', 'SQL Server')).toBe(false)
  })

  test('must-have-drop guard (F-A/F-B): a typo’d must-have skill is now credited, not dropped', () => {
    // Before F-H the over-rejection meant the coverage/grounding side saw NO Kubernetes even though
    // the (typo’d) profile holds it, so a required "Kubernetes" read as an unmet gap. With the fix
    // grounding credits it; the scored must-have list itself is never shrunk (F-B), so the requirement
    // stays present AND is now correctly recognized as held.
    const kept = groundJobSignals(mkSignals({ mustHaveSkills: ['Kubernetes'] }), 'A Docker shop.').signals.mustHaveSkills
    expect(kept).toEqual(['Kubernetes']) // requirement never dropped even absent from JD text (F-B)
    expect(groundingAccepts(typoK8s, 'Kubernetes')).toBe(true) // and the typo'd profile now grounds it (F-H)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 11 (Low-med): employer names ground full-credit scoring tokens. Desired: a company
// fact alone does not keep a candidateSkills token.
// -------------------------------------------------------------------------------------------
describe('finding 11: company name grounds a scoring skill token', () => {
  const oracleEmployer = mkProfile({
    skills: ['Azure'],
    roles: [{ company: 'Oracle Health', title: 'Support Engineer', startDate: '2020', endDate: null, bullets: ['Resolved customer tickets'] }],
  })

  test('FIXED: working AT "Oracle Health" must not keep the candidate skill "Oracle"', () => {
    expect(signalsKeep(oracleEmployer, 'Oracle')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 12 (Low): checkBannedTerms joins fields with a single space, so a multi-word banned
// term can match ACROSS two unrelated fields. Desired: no cross-field phantom violation.
// -------------------------------------------------------------------------------------------
describe('finding 12: banned term matching across concatenated field boundaries', () => {
  test('FIXED: "windows" ending one field + "server" starting the next must not trip "windows server"', () => {
    const profile = mkProfile({ skills: ['Azure'] })
    const out = mkTailored({ summary: 'Deployed Windows', coverLetter: 'Server 2019 rollout body.' })
    expect(checkBannedTerms(out, profile, ['windows server']).violations).toEqual([])
  })
})

// -------------------------------------------------------------------------------------------
// Composition: the F-A..F-J fixes landed independently but several touch the SAME mechanism
// (drop-handling in groundJobSignals; METRIC_RE extraction; "what counts as skill evidence";
// mentions() boundaries; the fit-score result shape). Each test below exercises one overlap
// pair/triple TOGETHER to pin that the fixes compose rather than merely pass in isolation.
// -------------------------------------------------------------------------------------------
describe('composition: F-A..F-J interactions', () => {
  const noReqs = { title: 'Eng', company: 'Co', mustHave: [], niceToHave: [] } as unknown as JobReqs
  const dimScore = (s: FitSignals, key: string): number =>
    assessFit(assembleFitInput(s, undefined, noReqs)).dimensions.find((d) => d.key === key)!.score

  test('F-A x F-B: mixed grounded/ungrounded must-haves AND certs, neither scored list ever shrinks', () => {
    // azure + az-104 appear in the JD; terraform + ccna do not (paraphrased). F-B's generalized rule
    // (never remove from a SCORED list) must hold for both fields at once, with F-A's cert port not
    // reintroducing a cert-only filter path. Only display-only preferred still drops.
    const jd = 'Needs Azure and infrastructure automation experience. AZ-104 required, plus a networking certification.'
    const s = mkSignals({
      mustHaveSkills: ['azure', 'terraform'],
      preferredSkills: ['fortran'], // absent from the JD: the one list that STILL drops
      requiredCerts: ['az-104', 'ccna'],
      candidateSkills: ['azure'],
      heldCerts: ['az-104'],
    })
    const honestSkills = dimScore(s, 'skillsCoverage')
    const honestCerts = dimScore(s, 'certRequirementFit')
    const g = groundJobSignals(s, jd)
    expect(g.signals.mustHaveSkills).toEqual(['azure', 'terraform']) // full list retained (F-B)
    expect(g.signals.requiredCerts).toEqual(['az-104', 'ccna']) // full list retained (F-A via F-B)
    expect(g.droppedJd).toEqual(['fortran']) // only preferred (display-only) is dropped/reported
    expect(dimScore(g.signals, 'skillsCoverage')).toBe(honestSkills) // grounding never raised either score
    expect(dimScore(g.signals, 'certRequirementFit')).toBe(honestCerts)
  })

  test('F-C x F-I/F-J: a multiplier count must not form across a FIELD boundary (prose side)', () => {
    // "grew to 2" (no unit) + "million users..." (no leading digit) would join to the F-J phrase
    // "2 million users" ONLY if fields were concatenated. F-C's per-field scanning must keep the
    // F-J multiplier branch from bridging the boundary: per field, no metric exists at all.
    const tailored = mkTailored({ summary: 'Our platform grew to 2', coverLetter: 'million users onboarded smoothly.' })
    expect(checkNoFabrication(tailored, mkProfile()).ungroundedMetrics).toEqual([])
  })

  test('F-C x F-J: a multiplier count must not GROUND across two profile FACTS (fact side)', () => {
    // Bullet 1 ends "...to 2" and bullet 2 starts "million users": neither fact alone asserts
    // "2 million users", so an invented claim at that value must still be flagged.
    const split = mkProfile({
      skills: [],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Grew the platform to 2', 'million users signed up in year two'] }],
    })
    const r = checkNoFabrication(mkTailored({ summary: 'Grew the platform to 2 million users.' }), split)
    expect(r.ungroundedMetrics.join(' ')).toMatch(/2 million users/i)
  })

  test('F-C x F-J regression: an in-ONE-field "2 million users" still extracts and grounds', () => {
    const whole = mkProfile({
      skills: [],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Grew the platform to 2 million users'] }],
    })
    // Normalized grounding: the fact's "2 million users" grounds the claim's "2,000,000 users".
    expect(checkNoFabrication(mkTailored({ summary: 'Grew to 2,000,000 users.' }), whole).ungroundedMetrics).toEqual([])
    // And with no supporting fact, the same single-field phrase is still caught (F-J escape closed).
    expect(checkNoFabrication(mkTailored({ summary: 'Grew to 2 million users.' }), mkProfile()).ungroundedMetrics.join(' ')).toMatch(/2 million users/i)
  })

  // F-F x F-G evidence-scope alignment (composition fix). F-F grounds banned-term exceptions against
  // CAPABILITY facts only (capabilityFactTexts: skills/certs/bullets/summary; title/company/edu
  // excluded, per finding 11). F-G's allowedAliasPairings originally read indexFacts(profile).texts,
  // the FULL corpus, so a curated alias form evidenced ONLY by a company name (or job title) was
  // offered to the tailor model as an approved pairing, which F-F's banned-term guard then refused to
  // license. allowedAliasPairings now grounds against capabilityFactTexts too, so the two mechanisms
  // agree (a company literally named "Kubernetes Consulting" is not Kubernetes experience).
  test('FIXED: F-F x F-G: a company-name-only alias evidence must NOT be offered as a pairing', () => {
    const companyOnly = mkProfile({
      skills: ['Azure'],
      roles: [{ company: 'Kubernetes Consulting', title: 'Account Manager', startDate: '2020', endDate: null, bullets: ['Managed client renewals'] }],
    })
    const job = { title: 'Eng', company: 'Co', mustHave: ['K8s'], niceToHave: [] } as unknown as JobReqs
    // Sanity: F-F is already strict here, the SAME evidence does not license the banned term.
    expect(checkBannedTerms(mkTailored({ summary: 'K8s work.' }), companyOnly, ['Kubernetes']).violations).toContain('Kubernetes')
    // FIXED: the pairing generator now grounds against capability facts too, so it offers nothing.
    expect(allowedAliasPairings(companyOnly, job)).toEqual([])
  })

  test('F-F x F-G agree on bullet evidence: pairing offered AND banned term licensed', () => {
    // A bullet-evidenced skill is capability evidence for BOTH mechanisms: F-G surfaces the pairing
    // (the point of the fix) and F-F licenses the term, so the offered option is actually shippable.
    const bulletOnly = mkProfile({
      skills: ['Azure'],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Operated K8s clusters in production'] }],
    })
    const job = { title: 'Eng', company: 'Co', mustHave: ['Kubernetes'], niceToHave: [] } as unknown as JobReqs
    expect(allowedAliasPairings(bulletOnly, job)).toContain('Kubernetes (k8s)')
    expect(checkBannedTerms(mkTailored({ summary: 'Kubernetes operations.' }), bulletOnly, ['Kubernetes']).violations).toEqual([])
  })

  test('F-E x F-B: a score produced through the retained-list path still carries aliasTableVersion', () => {
    // The F-B scenario: one unmet must-have ("terraform") is only PARAPHRASED in the JD. The retained
    // list keeps the honest 50, and the FitResult from that path must stamp the live table version.
    const jd = 'We need Kubernetes and infrastructure automation experience.'
    const s = mkSignals({ mustHaveSkills: ['kubernetes', 'terraform'], candidateSkills: ['kubernetes'] })
    const g = groundJobSignals(s, jd)
    expect(g.signals.mustHaveSkills).toEqual(['kubernetes', 'terraform'])
    const result = assessFit(assembleFitInput(g.signals, undefined, noReqs))
    expect(result.aliasTableVersion).toBe(skillAliases.ALIAS_TABLE_VERSION)
    expect(result.dimensions.find((d) => d.key === 'skillsCoverage')!.score).toBe(50) // honest, not 100
  })

  test('F-H x F-I/F-J: dotted-identifier grounding and multiplier metrics coexist in one packet', () => {
    // One profile exercises both regex families at once: the F-H typo'd skill must ground, the F-J
    // multiplier metric must ground at its normalized value, and neither check disturbs the other.
    const p = mkProfile({
      skills: ['Docker'],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Ran Docker.Kubernetes serving 2 million users'] }],
    })
    const r = checkNoFabrication(
      mkTailored({ skills: ['Kubernetes'], summary: 'Served 2,000,000 users on Kubernetes.' }),
      p,
    )
    expect(r.ungroundedSkills).toEqual([]) // F-H: the typo still grounds the standalone term
    expect(r.ungroundedMetrics).toEqual([]) // F-J: "2 million users" grounds "2,000,000 users"
    // And an unsupported dollar figure in the same packet is still caught with F-I's boundary intact:
    // "$5 monthly" is a bare $5, not $5M, so it does not accidentally ground off anything.
    const bad = checkNoFabrication(mkTailored({ summary: 'Saved $5 monthly per Kubernetes node.', skills: ['Kubernetes'] }), p)
    expect(bad.ungroundedMetrics).toContain('$5')
  })
})

// -------------------------------------------------------------------------------------------
// Finding 13 (Low): fitPresent collapses both comp-neutral notes into "No salary range was
// posted", which is false for the target-unavailable case (comp WAS posted).
// -------------------------------------------------------------------------------------------
describe('finding 13: wrong comp copy for the target-unavailable neutral case', () => {
  test('the not-posted neutral keeps its accurate copy (must keep passing)', () => {
    const line = humanizeNote({ key: 'compAlignment', label: 'Compensation alignment', weight: 0.12, score: 65, note: 'Comp not posted (neutral).' })
    expect(line).toContain('No salary range was posted')
  })

  test('FIXED: the target-unavailable neutral must NOT claim no salary range was posted', () => {
    const line = humanizeNote({ key: 'compAlignment', label: 'Compensation alignment', weight: 0.12, score: 65, note: 'Comp target unavailable (neutral).' })
    expect(line.includes('No salary range was posted')).toBe(false)
  })
})

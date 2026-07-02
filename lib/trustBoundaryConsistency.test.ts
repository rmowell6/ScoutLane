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

  test.fails('OPEN: invented "$40M" must NOT be grounded by the count "40 VMs"', () => {
    const r = checkNoFabrication(mkTailored({ coverLetter: 'I delivered $40M in savings.' }), vmProfile)
    expect(r.ungroundedMetrics.length).toBeGreaterThan(0)
  })

  test.fails('OPEN: real "$1,500,000" must be grounded by the fact "$1.5M" (shorthand equivalence)', () => {
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

  test.fails('OPEN: grounding must agree that a Vue.js-only profile does not ground "JavaScript"', () => {
    expect(groundingAccepts(vueOnly, 'JavaScript')).toBe(false)
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

  test.fails('OPEN: working AT "Oracle Health" must not keep the candidate skill "Oracle"', () => {
    expect(signalsKeep(oracleEmployer, 'Oracle')).toBe(false)
  })
})

// -------------------------------------------------------------------------------------------
// Finding 12 (Low): checkBannedTerms joins fields with a single space, so a multi-word banned
// term can match ACROSS two unrelated fields. Desired: no cross-field phantom violation.
// -------------------------------------------------------------------------------------------
describe('finding 12: banned term matching across concatenated field boundaries', () => {
  test.fails('OPEN: "windows" ending one field + "server" starting the next must not trip "windows server"', () => {
    const profile = mkProfile({ skills: ['Azure'] })
    const out = mkTailored({ summary: 'Deployed Windows', coverLetter: 'Server 2019 rollout body.' })
    expect(checkBannedTerms(out, profile, ['windows server']).violations).toEqual([])
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

  test.fails('OPEN: the target-unavailable neutral must NOT claim no salary range was posted', () => {
    const line = humanizeNote({ key: 'compAlignment', label: 'Compensation alignment', weight: 0.12, score: 65, note: 'Comp target unavailable (neutral).' })
    expect(line.includes('No salary range was posted')).toBe(false)
  })
})

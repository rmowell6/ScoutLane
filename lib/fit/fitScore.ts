// ScoutLane, Deterministic Fit-Assessment Engine (ported from fit_score.js, rubric 1.0.0).
//
// The fit score is the product's core value-add, so it must be REPRODUCIBLE: the same structured
// input always produces the same output, on any machine. Design (see docs/Fit_Assessment_SPEC.md):
//   - Extraction (fuzzy, upstream, LLM): reads resume + JD -> structured FitInput.
//   - Scoring (exact, THIS module): pure, rule-based math over FitInput. No model call, no
//     randomness, no Date/locale-by-default. Identical input -> identical output.
// This re-implementation must reproduce fit_score.golden.json byte-for-byte (parity test).
//
// Do NOT edit constants/formulas casually: a change alters the contract. On a deliberate rubric
// change, bump RUBRIC_VERSION and regenerate the golden file from the reference engine.

import { canonicalize } from '@/lib/skillAliases'

export const RUBRIC_VERSION = '1.0.0'

export type RoleTypeMatch = 'best' | 'solid' | 'stretch' | 'off'
export type SeniorityMatch = 'exact' | 'adjacent' | 'step_up' | 'mismatch'
export type EmployerType = 'direct' | 'managed_services' | 'consulting' | 'vendor'
export type LocationKind = 'remote_us' | 'local_metro' | 'hybrid_confirm' | 'onsite_elsewhere'
export type Vertical = 'match' | 'adjacent' | 'none'

export interface LocationFlags {
  onCall?: boolean
  travelModerate?: boolean
  travelHeavy?: boolean
}

export interface FitFlags {
  expired?: boolean
  unconfirmedLive?: boolean
  defenseAdjacent?: boolean
  heavyTravelOrPresales?: boolean
}

export interface FitInput {
  roleId?: string
  title?: string
  roleTypeMatch: RoleTypeMatch
  mustHaveSkills: string[]
  /** JD preferred / nice-to-have skills (canonical tokens). Display-only for ATS keyword coverage;
   *  NOT used by assessFit, so the score stays a function of the must-haves. */
  preferredSkills?: string[]
  candidateSkills: string[]
  adjacentSkills?: string[]
  seniorityMatch: SeniorityMatch
  compTopUsd: number | null
  targetCompTopUsd: number
  employerType: EmployerType
  location: LocationKind
  locationFlags?: LocationFlags
  vertical: Vertical
  requiredCerts?: string[]
  heldCerts?: string[]
  adjacentCerts?: string[]
  hardGaps?: string[]
  flags?: FitFlags
  lanesSurfaced?: number
}

export interface FitDimension {
  key: string
  label: string
  weight: number
  score: number
  note: string
}

export interface FitPenalties {
  hardGaps: number
  expired: number
  unconfirmedLive: number
  defenseAdjacent: number
  heavyTravelOrPresales: number
}

export interface FitResult {
  version: string
  overall: number
  band: string
  base: number
  bonus: number
  penaltyTotal: number
  penalties: FitPenalties
  hardGaps: string[]
  dimensions: FitDimension[]
}

// Dimension weights (must sum to 1.0). Order here is the output order.
export const WEIGHTS: Record<string, number> = {
  roleTypeMatch: 0.2,
  skillsCoverage: 0.22,
  seniorityMatch: 0.1,
  compAlignment: 0.12,
  employerPreference: 0.1,
  locationLogistics: 0.1,
  verticalFit: 0.08,
  certRequirementFit: 0.08,
}

const LABELS: Record<string, string> = {
  roleTypeMatch: 'Role-type match',
  skillsCoverage: 'Core skills coverage',
  seniorityMatch: 'Seniority / scope match',
  compAlignment: 'Compensation alignment',
  employerPreference: 'Employer-type preference',
  locationLogistics: 'Location & logistics',
  verticalFit: 'Domain / vertical fit',
  certRequirementFit: 'Certifications & specialized reqs',
}

// Categorical lookup tables (the LLM supplies the category; we supply the number).
const ROLE_TYPE: Record<string, number> = { best: 100, solid: 80, stretch: 60, off: 35 }
const SENIORITY: Record<string, number> = { exact: 95, adjacent: 78, step_up: 55, mismatch: 40 }
const EMPLOYER: Record<string, number> = { direct: 100, managed_services: 70, consulting: 50, vendor: 45 }
const LOCATION: Record<string, number> = { remote_us: 95, local_metro: 90, hybrid_confirm: 70, onsite_elsewhere: 30 }
const VERTICAL: Record<string, number> = { match: 90, adjacent: 70, none: 55 }

const PENALTY = { hardGapEach: 5, hardGapCap: 10, expired: 15, unconfirmedLive: 6, defenseAdjacent: 10, heavyTravelOrPresales: 4 }
const LOC_DEDUCT = { onCall: 6, travelModerate: 3, travelHeavy: 8 }
const CROSS_LANE_PER = 2
const CROSS_LANE_CAP = 6

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const round1 = (n: number) => Math.round(n * 10) / 10

// Thousands separators WITHOUT toLocaleString: the engine must be reproducible on any machine,
// and Intl/ICU output can vary by Node build (a minimal-ICU runtime would emit "215000", breaking
// golden parity). Operates on the integer part only; comp values are whole USD amounts.
const withThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export interface CoverageResult {
  score: number
  full: number
  partial: number
  total: number
}

// list-coverage scorer (skills, certs): full match = 1, adjacent = 0.5. Both sides are run through
// canonicalize (a deterministic curated-alias table lookup, no fuzzy/model matching) so equivalent
// terms written differently ("K8s" vs "Kubernetes") still count. Purely additive: a term not in the
// alias table canonicalizes to its plain normalized form, so exact matching is unchanged.
export function coverage(
  required: string[] | undefined,
  held: string[] | undefined,
  adjacent: string[] | undefined,
  neutralIfEmpty: number,
): CoverageResult {
  const heldSet = new Set((held || []).map(canonicalize))
  const adjSet = new Set((adjacent || []).map(canonicalize))
  let full = 0
  let partial = 0
  for (const r of required || []) {
    const k = canonicalize(r)
    if (heldSet.has(k)) full++
    else if (adjSet.has(k)) partial++
  }
  const total = (required || []).length
  const score = total === 0 ? neutralIfEmpty : Math.round((100 * (full + 0.5 * partial)) / total)
  return { score, full, partial, total }
}

// compensation: posted top-of-band vs the candidate's target top
export function scoreComp(compTopUsd: number | null, targetTopUsd: number): { score: number; note: string } {
  if (compTopUsd == null) return { score: 65, note: 'Comp not posted (neutral).' }
  // A non-positive or non-finite target (user left it blank/0, or an upstream fallback) makes the
  // ratio Infinity/NaN, which would silently bucket to a misleading score. Treat it as "no usable
  // target" and return the same neutral value as an unposted comp rather than fabricating a verdict.
  if (!Number.isFinite(targetTopUsd) || targetTopUsd <= 0 || !Number.isFinite(compTopUsd) || compTopUsd <= 0) {
    return { score: 65, note: 'Comp target unavailable (neutral).' }
  }
  const r = compTopUsd / targetTopUsd
  let score: number
  if (r >= 1.1) score = 100
  else if (r >= 1.0) score = 92
  else if (r >= 0.97) score = 85
  else if (r >= 0.9) score = 78
  else if (r >= 0.8) score = 62
  else score = 45
  return {
    score,
    note: `Posted top $${withThousands(compTopUsd)} vs target $${withThousands(targetTopUsd)} (ratio ${r.toFixed(2)}).`,
  }
}

// location & logistics
export function scoreLocation(location: string, flags: LocationFlags | undefined): { score: number; note: string } {
  let s = LOCATION[location] ?? 55
  const f = flags || {}
  const deductions: string[] = []
  if (f.onCall) {
    s -= LOC_DEDUCT.onCall
    deductions.push('on-call')
  }
  if (f.travelHeavy) {
    s -= LOC_DEDUCT.travelHeavy
    deductions.push('heavy travel')
  } else if (f.travelModerate) {
    s -= LOC_DEDUCT.travelModerate
    deductions.push('some travel')
  }
  return { score: clamp(s, 0, 100), note: `${location}${deductions.length ? ' (−' + deductions.join(', −') + ')' : ''}.` }
}

// assessFit(input) -> FitResult (the deterministic core)
export function assessFit(input: FitInput): FitResult {
  const dims: FitDimension[] = []
  const push = (key: string, score: number, note: string) =>
    dims.push({ key, label: LABELS[key] ?? key, weight: WEIGHTS[key] ?? 0, score, note })

  // 1. role-type match (categorical)
  const rt = ROLE_TYPE[input.roleTypeMatch] ?? 35
  push('roleTypeMatch', rt, `Target-title fit: ${input.roleTypeMatch}.`)

  // 2. skills coverage (computed from lists)
  const sk = coverage(input.mustHaveSkills, input.candidateSkills, input.adjacentSkills, 80)
  push('skillsCoverage', sk.score, `${sk.full} of ${sk.total} must-haves matched${sk.partial ? `, ${sk.partial} partial` : ''}.`)

  // 3. seniority / scope match (categorical)
  const sen = SENIORITY[input.seniorityMatch] ?? 40
  push('seniorityMatch', sen, `Level fit: ${input.seniorityMatch}.`)

  // 4. compensation alignment (computed)
  const comp = scoreComp(input.compTopUsd ?? null, input.targetCompTopUsd)
  push('compAlignment', comp.score, comp.note)

  // 5. employer-type preference (categorical; reflects direct-employer preference)
  const emp = EMPLOYER[input.employerType] ?? 45
  push('employerPreference', emp, `Employer type: ${input.employerType}.`)

  // 6. location & logistics (computed)
  const loc = scoreLocation(input.location, input.locationFlags)
  push('locationLogistics', loc.score, loc.note)

  // 7. domain / vertical fit (categorical)
  const vert = VERTICAL[input.vertical] ?? 55
  push('verticalFit', vert, `Vertical: ${input.vertical}.`)

  // 8. certifications & specialized requirements (computed; neutral 80 if none required)
  const cert = coverage(input.requiredCerts, input.heldCerts, input.adjacentCerts, 80)
  push(
    'certRequirementFit',
    cert.score,
    input.requiredCerts && input.requiredCerts.length
      ? `${cert.full} of ${cert.total} required certs held${cert.partial ? `, ${cert.partial} partial` : ''}.`
      : 'No specific certs required (neutral).',
  )

  // weighted base
  const base = dims.reduce((acc, d) => acc + d.weight * d.score, 0)

  // penalties
  const f = input.flags || {}
  const hardGapPenalty = Math.min((input.hardGaps || []).length * PENALTY.hardGapEach, PENALTY.hardGapCap)
  const penalties: FitPenalties = {
    hardGaps: hardGapPenalty,
    expired: f.expired ? PENALTY.expired : 0,
    unconfirmedLive: f.unconfirmedLive ? PENALTY.unconfirmedLive : 0,
    defenseAdjacent: f.defenseAdjacent ? PENALTY.defenseAdjacent : 0,
    heavyTravelOrPresales: f.heavyTravelOrPresales ? PENALTY.heavyTravelOrPresales : 0,
  }
  const penaltyTotal = Object.values(penalties).reduce((a, b) => a + b, 0)

  // cross-lane conviction bonus
  const lanes = input.lanesSurfaced || 1
  const bonus = Math.min(Math.max(lanes - 1, 0) * CROSS_LANE_PER, CROSS_LANE_CAP)

  const overall = clamp(Math.round(base - penaltyTotal + bonus), 0, 100)
  const band = overall >= 88 ? 'Best fit' : overall >= 78 ? 'Strong fit' : overall >= 65 ? 'Stretch' : 'Lead'

  return {
    version: RUBRIC_VERSION,
    overall,
    band,
    base: round1(base),
    bonus,
    penaltyTotal,
    penalties,
    hardGaps: input.hardGaps || [],
    dimensions: dims,
  }
}

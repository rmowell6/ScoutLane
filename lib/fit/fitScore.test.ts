// Parity + correctness tests for the deterministic fit engine (ported from fit_score.test.js).
// The GOLDEN tests are the cross-implementation contract: assessFit(input) must reproduce
// fit_score.golden.json exactly for each case. Regenerate golden only on a deliberate rubric change.
import { describe, it, expect } from 'vitest'
import { assessFit, coverage, scoreComp, scoreLocation, WEIGHTS, type FitInput } from './fitScore'
import { ALIAS_GROUPS, ALIAS_TABLE_VERSION, computeAliasTableVersion } from '@/lib/skillAliases'
import golden from './fitScore.golden.json'

const cases = golden.cases as Array<{ name: string; input: FitInput; expected: Record<string, unknown> }>

describe('golden parity (cross-implementation contract)', () => {
  for (const c of cases) {
    it('reproduces expected output: ' + c.name, () => {
      // The golden fixtures pin the SCORE. aliasTableVersion is content-derived basis metadata that
      // legitimately changes whenever the alias table is refreshed, so it is injected from the live
      // constant rather than frozen into the JSON (which would force a golden regen on every table
      // change). version (the semantic rubric constant) stays pinned in the fixtures as before.
      expect(assessFit(c.input)).toEqual({ ...c.expected, aliasTableVersion: ALIAS_TABLE_VERSION })
    })
  }
})

describe('FitResult shape (independent of the golden fixtures)', () => {
  // A reordering or dropped-dimension bug would otherwise only surface as a golden deep-equal
  // mismatch; assert the structural contract directly so it is pinned on its own.
  const input: FitInput = {
    roleTypeMatch: 'solid',
    mustHaveSkills: ['a', 'b'],
    candidateSkills: ['a'],
    seniorityMatch: 'adjacent',
    compTopUsd: 150000,
    targetCompTopUsd: 170000,
    employerType: 'direct',
    location: 'remote_us',
    vertical: 'match',
    hardGaps: ['clearance', 'relocation'],
  }
  it('emits all 8 dimensions in the fixed rubric order and echoes hardGaps back unmodified', () => {
    const r = assessFit(input)
    const keys = r.dimensions.map((d) => d.key)
    expect(keys).toHaveLength(8)
    expect(keys).toEqual([
      'roleTypeMatch',
      'skillsCoverage',
      'seniorityMatch',
      'compAlignment',
      'employerPreference',
      'locationLogistics',
      'verticalFit',
      'certRequirementFit',
    ])
    expect(r.hardGaps).toEqual(['clearance', 'relocation'])
  })

  // Finding 6 / F-E: the score depends on the alias table (coverage -> canonicalize), so the result
  // stamps ALIAS_TABLE_VERSION alongside RUBRIC_VERSION. Two scores for the SAME input computed against
  // different table states must be distinguishable via the stamp, even when the numeric score is equal.
  it('stamps the current ALIAS_TABLE_VERSION (and the rubric version) on the result', () => {
    const r = assessFit(input)
    expect(r.aliasTableVersion).toBe(ALIAS_TABLE_VERSION)
    expect(typeof r.aliasTableVersion).toBe('string')
    expect(r.aliasTableVersion).not.toBe(r.version) // formula version and table version are distinct axes
  })

  it('two identical-input scores are distinguishable when the alias table changes (attributable)', () => {
    const before = assessFit(input)
    // Simulate a Phase-8 table refresh: the version constant would change to the new table's hash.
    const afterVersion = computeAliasTableVersion([...ALIAS_GROUPS, ['some-new-skill', 'sns']])
    const after = { ...assessFit(input), aliasTableVersion: afterVersion }
    expect(after.overall).toBe(before.overall) // the number can be unchanged...
    expect(after.aliasTableVersion).not.toBe(before.aliasTableVersion) // ...yet the basis is attributable
    expect(before.aliasTableVersion).toBe(ALIAS_TABLE_VERSION)
  })
})

describe('determinism', () => {
  it('same input yields identical output twice', () => {
    for (const c of cases) {
      expect(assessFit(c.input)).toEqual(assessFit(c.input))
    }
  })
  it('does not mutate its input', () => {
    const input = cases[0]!.input
    const snapshot = JSON.stringify(input)
    assessFit(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('weights', () => {
  it('sum to exactly 1.0', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.round(sum * 1000) / 1000).toBe(1.0)
  })
})

describe('scoreComp boundaries', () => {
  it('not posted is neutral 65', () => {
    expect(scoreComp(null, 170000).score).toBe(65)
  })
  it('1.10x target gives 100', () => {
    expect(scoreComp(187000, 170000).score).toBe(100)
  })
  it('exactly at target gives 92', () => {
    expect(scoreComp(170000, 170000).score).toBe(92)
  })
  it('just under target 0.99x gives 85', () => {
    expect(scoreComp(169100, 170000).score).toBe(85)
  })
  it('0.9x gives 78', () => {
    expect(scoreComp(153000, 170000).score).toBe(78)
  })
  it('well below 0.7x gives 45', () => {
    expect(scoreComp(119000, 170000).score).toBe(45)
  })
  it('a zero/negative target is neutral, not Infinity-bucketed', () => {
    // target 0 → ratio Infinity → would otherwise score 100 with a "ratio Infinity" note.
    expect(scoreComp(150000, 0).score).toBe(65)
    expect(scoreComp(150000, -1).score).toBe(65)
  })
  it('a non-finite input is neutral, never NaN', () => {
    expect(scoreComp(150000, Number.NaN).score).toBe(65)
    expect(scoreComp(Number.POSITIVE_INFINITY, 170000).score).toBe(65)
  })
  it('a non-positive posted comp is neutral (no divide-by-tiny blow-up)', () => {
    expect(scoreComp(0, 170000).score).toBe(65)
  })
})

describe('coverage (skills/certs)', () => {
  it('2 full, 1 partial of 4 gives 63', () => {
    expect(coverage(['a', 'b', 'c', 'd'], ['a', 'b'], ['c'], 80)).toEqual({ score: 63, full: 2, partial: 1, total: 4 })
  })
  it('empty required gives neutral', () => {
    expect(coverage([], [], [], 80).score).toBe(80)
  })
  it('matching is case-insensitive', () => {
    expect(coverage(['Azure'], ['azure'], [], 80).full).toBe(1)
  })

  it('canonical synonyms count as a full match (K8s held covers a Kubernetes requirement)', () => {
    const r = coverage(['Kubernetes'], ['K8s'], [], 80)
    expect(r.full).toBe(1)
    expect(r.score).toBe(100)
  })

  it('does NOT match genuinely different skills after canonicalization (no false positive)', () => {
    const r = coverage(['Kubernetes'], ['Docker'], [], 80)
    expect(r.full).toBe(0)
    expect(r.score).toBe(0)
  })
})

describe('scoreLocation deductions', () => {
  it('remote US clean is 95', () => {
    expect(scoreLocation('remote_us', {}).score).toBe(95)
  })
  it('hybrid with on-call and some travel is 61', () => {
    expect(scoreLocation('hybrid_confirm', { onCall: true, travelModerate: true }).score).toBe(61)
  })
  it('heavy travel beats moderate and is not additive', () => {
    expect(scoreLocation('remote_us', { travelHeavy: true, travelModerate: true }).score).toBe(87)
  })
})

describe('penalties and band', () => {
  const base = cases[1]!.input
  it('expired posting drops the score by 15', () => {
    const withExpired = { ...base, flags: { ...base.flags, expired: true } }
    expect(assessFit(withExpired).overall).toBe(assessFit(base).overall - 15)
  })
  it('a hard gap applies a capped penalty', () => {
    const withGap = { ...base, hardGaps: ['kubernetes', 'gitops'] }
    const r = assessFit(withGap)
    expect(r.penalties.hardGaps).toBe(10)
    expect(r.overall).toBe(assessFit(base).overall - 10)
  })
})

describe('engagement + work-authorization penalties (rubric 1.1.0)', () => {
  const base: FitInput = {
    roleTypeMatch: 'best',
    mustHaveSkills: ['aws'],
    candidateSkills: ['aws'],
    seniorityMatch: 'exact',
    compTopUsd: 180000,
    targetCompTopUsd: 170000,
    employerType: 'direct',
    location: 'remote_us',
    vertical: 'match',
  }

  it('applies workAuthMismatch (25) ONLY when the candidate needs sponsorship AND the JD offers none', () => {
    expect(assessFit({ ...base, needsSponsorship: true, sponsorshipAvailable: 'no' }).penalties.workAuthMismatch).toBe(25)
    // Either side unspecified/absent -> no penalty (never inferred from missing data).
    expect(assessFit({ ...base, needsSponsorship: true, sponsorshipAvailable: 'unspecified' }).penalties.workAuthMismatch).toBe(0)
    expect(assessFit({ ...base, sponsorshipAvailable: 'no' }).penalties.workAuthMismatch).toBe(0)
    expect(assessFit(base).penalties.workAuthMismatch).toBe(0)
  })

  it('applies engagementMismatch (8) ONLY on a cross-family explicit mismatch (W2 vs independent)', () => {
    expect(assessFit({ ...base, preferredEngagementType: 'w2_fte', engagementType: 'c2c' }).penalties.engagementMismatch).toBe(8)
    // Same family (permanent vs contract within W2) is a preference, not a blocker -> no penalty.
    expect(assessFit({ ...base, preferredEngagementType: 'w2_fte', engagementType: 'w2_contract' }).penalties.engagementMismatch).toBe(0)
    // Unspecified on either side -> no penalty.
    expect(assessFit({ ...base, preferredEngagementType: 'w2_fte', engagementType: 'unspecified' }).penalties.engagementMismatch).toBe(0)
    expect(assessFit(base).penalties.engagementMismatch).toBe(0)
  })

  it('work-auth is the larger drop, and both are exact deductions off the clean score', () => {
    const clean = assessFit(base).overall
    const wa = assessFit({ ...base, needsSponsorship: true, sponsorshipAvailable: 'no' }).overall
    const eng = assessFit({ ...base, preferredEngagementType: 'w2_fte', engagementType: 'c2c' }).overall
    expect(clean - wa).toBe(25)
    expect(clean - eng).toBe(8)
    expect(wa).toBeLessThan(eng)
  })

  it('optional fields absent (profiles that predate this feature) score identically to no penalty', () => {
    expect(assessFit(base).penaltyTotal).toBe(0)
  })
})

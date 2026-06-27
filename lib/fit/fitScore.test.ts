// Parity + correctness tests for the deterministic fit engine (ported from fit_score.test.js).
// The GOLDEN tests are the cross-implementation contract: assessFit(input) must reproduce
// fit_score.golden.json exactly for each case. Regenerate golden only on a deliberate rubric change.
import { describe, it, expect } from 'vitest'
import { assessFit, coverage, scoreComp, scoreLocation, WEIGHTS, type FitInput } from './fitScore'
import golden from './fitScore.golden.json'

const cases = golden.cases as Array<{ name: string; input: FitInput; expected: unknown }>

describe('golden parity (cross-implementation contract)', () => {
  for (const c of cases) {
    it('reproduces expected output: ' + c.name, () => {
      expect(assessFit(c.input)).toEqual(c.expected)
    })
  }
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

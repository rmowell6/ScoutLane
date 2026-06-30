import { describe, expect, test } from 'vitest'
import { assessFit, type FitInput } from './fitScore'
import { isUnassessed, bandLabel, PENALTY_LABELS } from './fitPresent'

// A fully-scored baseline input (every dimension has real data). Vary one field per case so the
// engine emits the neutral placeholder we want to detect, then assert isUnassessed agrees with the
// REAL note text. This pins the presentation heuristic to the engine's actual output.
const base: FitInput = {
  roleTypeMatch: 'best',
  mustHaveSkills: ['azure', 'windows server'],
  candidateSkills: ['azure', 'windows server'],
  seniorityMatch: 'exact',
  compTopUsd: 180_000,
  targetCompTopUsd: 170_000,
  employerType: 'direct',
  location: 'remote_us',
  vertical: 'match',
  requiredCerts: ['security+'],
  heldCerts: ['security+'],
}

const dimOf = (input: FitInput, key: string) =>
  assessFit(input).dimensions.find((d) => d.key === key)!

describe('isUnassessed (coupled to the engine note format)', () => {
  test('comp with no posted band is flagged not-assessed; a posted band is not', () => {
    expect(isUnassessed(dimOf({ ...base, compTopUsd: null }, 'compAlignment'))).toBe(true)
    expect(isUnassessed(dimOf({ ...base, targetCompTopUsd: 0 }, 'compAlignment'))).toBe(true)
    expect(isUnassessed(dimOf(base, 'compAlignment'))).toBe(false)
  })

  test('no required certs is flagged not-assessed; required certs are scored', () => {
    expect(isUnassessed(dimOf({ ...base, requiredCerts: [] }, 'certRequirementFit'))).toBe(true)
    expect(isUnassessed(dimOf(base, 'certRequirementFit'))).toBe(false)
  })

  test('an empty must-have skills list is flagged not-assessed; a real list is scored', () => {
    expect(isUnassessed(dimOf({ ...base, mustHaveSkills: [] }, 'skillsCoverage'))).toBe(true)
    expect(isUnassessed(dimOf(base, 'skillsCoverage'))).toBe(false)
  })

  test('genuinely scored categorical dimensions are never flagged not-assessed', () => {
    for (const key of ['roleTypeMatch', 'seniorityMatch', 'employerPreference', 'locationLogistics', 'verticalFit']) {
      expect(isUnassessed(dimOf(base, key)), key).toBe(false)
    }
  })
})

describe('bandLabel', () => {
  test('maps the internal "Lead" band to plain language, passes others through', () => {
    expect(bandLabel('Lead')).toBe('Long shot')
    expect(bandLabel('Best fit')).toBe('Best fit')
    expect(bandLabel('Strong fit')).toBe('Strong fit')
    expect(bandLabel('Stretch')).toBe('Stretch')
  })
})

describe('PENALTY_LABELS', () => {
  test('covers every penalty key the engine can emit', () => {
    const r = assessFit({ ...base, hardGaps: ['x'], flags: { expired: true } })
    for (const key of Object.keys(r.penalties)) {
      expect(PENALTY_LABELS[key], key).toBeTruthy()
    }
  })
})

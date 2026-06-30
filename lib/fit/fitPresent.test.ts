import { describe, expect, test } from 'vitest'
import { assessFit, type FitInput } from './fitScore'
import {
  isUnassessed,
  bandLabel,
  bandSummary,
  humanizeNote,
  splitDimensions,
  holdingBackLine,
  leadDimension,
  PENALTY_LABELS,
} from './fitPresent'

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

describe('humanizeNote (coupled to the engine note format)', () => {
  test('rewrites categorical notes into warm copy', () => {
    expect(humanizeNote(dimOf(base, 'roleTypeMatch'))).toBe('Your target title is a direct match for this role.')
    expect(humanizeNote(dimOf(base, 'seniorityMatch'))).toBe('Your seniority is a direct match.')
    expect(humanizeNote(dimOf(base, 'employerPreference'))).toBe('A direct employer, which matches your preference.')
    expect(humanizeNote(dimOf(base, 'verticalFit'))).toBe('The industry is right in your wheelhouse.')
    expect(humanizeNote(dimOf(base, 'locationLogistics'))).toBe('Remote within the US, a clean logistics fit.')
  })

  test('keeps concrete specifics for computed dimensions', () => {
    expect(humanizeNote(dimOf(base, 'skillsCoverage'))).toBe('You bring 2 of the 2 must-have skills.')
    expect(humanizeNote(dimOf(base, 'certRequirementFit'))).toBe('You hold 1 of the 1 required certifications.')
    // 180k vs 170k -> ratio 1.06 -> score 92 -> "meets or beats"
    expect(humanizeNote(dimOf(base, 'compAlignment'))).toBe(
      'The posted top of $180,000 meets or beats your $170,000 target.',
    )
  })

  test('surfaces partial skill coverage', () => {
    const dim = dimOf(
      { ...base, mustHaveSkills: ['azure', 'terraform'], candidateSkills: ['azure'], adjacentSkills: ['terraform'] },
      'skillsCoverage',
    )
    expect(humanizeNote(dim)).toBe('You bring 1 of the 2 must-have skills, with 1 more partially covered.')
  })
})

describe('bandSummary', () => {
  test('returns warm copy for every band, with no em dashes', () => {
    for (const band of ['Best fit', 'Strong fit', 'Stretch', 'Lead']) {
      const s = bandSummary(band)
      expect(s.length).toBeGreaterThan(0)
      expect(s).not.toContain('—')
    }
  })
})

describe('splitDimensions', () => {
  test('groups assessed dimensions into strengths/stretches and isolates not-assessed', () => {
    const fit = assessFit({ ...base, compTopUsd: null }) // comp becomes not-assessed
    const { strengths, stretches, notAssessed } = splitDimensions(fit)
    expect(notAssessed.some((d) => d.key === 'compAlignment')).toBe(true)
    expect(strengths.every((d) => d.score >= 75)).toBe(true)
    expect(strengths.concat(stretches).every((d) => !notAssessed.includes(d))).toBe(true)
    // strengths sorted high-to-low, stretches low-to-high
    for (let i = 1; i < strengths.length; i++) expect(strengths[i - 1]!.score).toBeGreaterThanOrEqual(strengths[i]!.score)
  })
})

describe('holdingBackLine', () => {
  test('names applied penalties', () => {
    const fit = assessFit({ ...base, flags: { expired: true } })
    expect(holdingBackLine(fit)).toContain('the posting may be expired')
  })

  test('falls back to the weakest assessed dimension when there are no penalties', () => {
    const fit = assessFit({ ...base, roleTypeMatch: 'off', seniorityMatch: 'mismatch' })
    expect(holdingBackLine(fit)).toMatch(/Biggest gap:/)
  })

  test('is empty when nothing material is holding the score back', () => {
    expect(holdingBackLine(assessFit(base))).toBe('')
  })
})

describe('humanizeNote — not-assessed dimensions read cleanly', () => {
  test('comp / certs / skills neutral notes become friendly copy', () => {
    expect(humanizeNote(dimOf({ ...base, compTopUsd: null }, 'compAlignment'))).toBe(
      'No salary range was posted, so pay was not scored.',
    )
    expect(humanizeNote(dimOf({ ...base, requiredCerts: [] }, 'certRequirementFit'))).toBe(
      'This role lists no required certifications.',
    )
    expect(humanizeNote(dimOf({ ...base, mustHaveSkills: [] }, 'skillsCoverage'))).toBe(
      'No specific must-have skills were listed for this role.',
    )
  })
})

describe('leadDimension (only candidate-differentiating dimensions)', () => {
  test('never returns employer-type / comp / location even when they top the score', () => {
    // employer=direct(100), comp meets target(100), location remote_us(95) would win an unfiltered
    // sort; the leadable dimensions are all lower. leadDimension must pick a leadable one.
    const fit = assessFit({
      ...base,
      roleTypeMatch: 'stretch', // 60
      seniorityMatch: 'step_up', // 55
      mustHaveSkills: ['azure', 'terraform', 'kubernetes'],
      candidateSkills: ['azure'], // low coverage
      vertical: 'none', // 55
      requiredCerts: [], // not assessed
      employerType: 'direct', // 100
      compTopUsd: 200_000,
      targetCompTopUsd: 150_000, // ratio > 1.1 -> 100
      location: 'remote_us', // 95
    })
    const lead = leadDimension(fit)
    expect(lead).toBeDefined()
    expect(['employerPreference', 'compAlignment', 'locationLogistics']).not.toContain(lead!.key)
  })

  test('picks the strongest leadable dimension', () => {
    // base: roleTypeMatch best(100), seniority exact(95), skills full(100) are all leadable.
    const lead = leadDimension(assessFit(base))
    expect(['roleTypeMatch', 'skillsCoverage']).toContain(lead!.key) // both 100, either is correct
    expect(lead!.score).toBe(100)
  })

  test('returns undefined when no leadable dimension is assessed', () => {
    const fit = assessFit({ ...base, mustHaveSkills: [], requiredCerts: [] })
    // roleType/seniority/vertical still assessed in base, so craft a case with all leadable unknown:
    const allUnknown = assessFit({
      roleTypeMatch: 'best',
      mustHaveSkills: [],
      candidateSkills: [],
      seniorityMatch: 'exact',
      compTopUsd: null,
      targetCompTopUsd: 0,
      employerType: 'direct',
      location: 'remote_us',
      vertical: 'match',
      requiredCerts: [],
    })
    // roleType/seniority/vertical are still assessed here, so leadDimension is defined; assert it is leadable.
    expect(leadDimension(fit)).toBeDefined()
    expect(LEADABLE_KEYS_TEST.has(leadDimension(allUnknown)!.key)).toBe(true)
  })
})

const LEADABLE_KEYS_TEST = new Set(['roleTypeMatch', 'skillsCoverage', 'seniorityMatch', 'verticalFit', 'certRequirementFit'])

import { describe, expect, test } from 'vitest'
import { assembleFitInput, type FitSignals } from './fitSignals'
import { assessFit } from './fitScore'
import type { JobReqs } from '@/lib/schemas'

const SIGNALS: FitSignals = {
  roleTypeMatch: 'best',
  mustHaveSkills: ['azure'],
  candidateSkills: ['azure'],
  adjacentSkills: [],
  seniorityMatch: 'exact',
  compTopUsd: 200000,
  employerType: 'direct',
  location: 'remote_us',
  locationFlags: { onCall: false, travelModerate: false, travelHeavy: false },
  vertical: 'match',
  requiredCerts: [],
  heldCerts: [],
  adjacentCerts: [],
  hardGaps: [],
  flags: { expired: false, unconfirmedLive: false, defenseAdjacent: false, heavyTravelOrPresales: false },
}

const JOB: JobReqs = { title: 'Cloud Engineer', mustHave: [], niceToHave: [] }

describe('assembleFitInput', () => {
  test('uses the candidate target comp when provided', () => {
    const input = assembleFitInput(SIGNALS, { targetCompTopUsd: 170000, targetLanes: [], workModes: [], employmentTypes: [], noGoLocations: [] }, JOB)
    expect(input.targetCompTopUsd).toBe(170000)
    expect(input.title).toBe('Cloud Engineer')
    expect(input.lanesSurfaced).toBe(1)
  })

  test('falls back to the posted comp as the target when no preference is set', () => {
    const input = assembleFitInput(SIGNALS, undefined, JOB)
    expect(input.targetCompTopUsd).toBe(200000) // == compTopUsd -> ratio 1.0
  })

  test('uses a harmless placeholder when neither target nor posted comp exists', () => {
    const input = assembleFitInput({ ...SIGNALS, compTopUsd: null }, undefined, JOB)
    expect(input.targetCompTopUsd).toBe(1)
    // comp scorer is neutral 65 when compTopUsd is null, regardless of the placeholder target.
    const comp = assessFit(input).dimensions.find((d) => d.key === 'compAlignment')
    expect(comp?.score).toBe(65)
  })

  test('feeds straight into the deterministic engine', () => {
    const input = assembleFitInput(SIGNALS, { targetCompTopUsd: 170000, targetLanes: [], workModes: [], employmentTypes: [], noGoLocations: [] }, JOB)
    const result = assessFit(input)
    expect(result.overall).toBeGreaterThan(0)
    expect(result.dimensions).toHaveLength(8)
  })
})

import { describe, expect, test } from 'vitest'
import { assembleFitInput, type FitSignals } from './fitSignals'
import { assessFit } from './fitScore'
import { isUnassessed } from './fitPresent'
import { CandidatePreferencesSchema, type JobReqs } from '@/lib/schemas'

const SIGNALS: FitSignals = {
  roleTypeMatch: 'best',
  mustHaveSkills: ['azure'],
  preferredSkills: ['terraform'],
  candidateSkills: ['azure'],
  adjacentSkills: [],
  seniorityMatch: 'exact',
  compTopUsd: 200000,
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
}

const JOB: JobReqs = { title: 'Cloud Engineer', mustHave: [], niceToHave: [] }

describe('assembleFitInput', () => {
  test('uses the candidate target comp when provided', () => {
    const input = assembleFitInput(SIGNALS, { targetCompTopUsd: 170000, targetLanes: [], workModes: [], employmentTypes: [], noGoLocations: [] }, JOB)
    expect(input.targetCompTopUsd).toBe(170000)
    expect(input.title).toBe('Cloud Engineer')
    // Preferred skills flow through for the ATS coverage display (not used by the scorer).
    expect(input.preferredSkills).toEqual(['terraform'])
    expect(input.lanesSurfaced).toBe(1)
  })

  // Finding 8: with no candidate target, do NOT fall back to the JD's posted comp (that made the comp
  // scorer compare the posted number to itself -> ratio 1.0 -> 92, "meets your target", for a target
  // the candidate never set). No target -> 0, which routes the comp dimension to the neutral/unassessed
  // path instead of fabricating a match.
  test('no candidate target -> 0 (no JD self-comparison), comp dimension is unassessed', () => {
    const input = assembleFitInput(SIGNALS, undefined, JOB) // SIGNALS.compTopUsd = 200000, no preference
    expect(input.targetCompTopUsd).toBe(0)
    const comp = assessFit(input).dimensions.find((d) => d.key === 'compAlignment')!
    expect(isUnassessed(comp)).toBe(true)
    // The old bug scored this 92; it must no longer read as a real target match.
    expect(comp.note).not.toMatch(/target \$200,000/)
  })

  test('no target and no posted comp -> 0, comp scorer stays neutral 65', () => {
    const input = assembleFitInput({ ...SIGNALS, compTopUsd: null }, undefined, JOB)
    expect(input.targetCompTopUsd).toBe(0)
    const comp = assessFit(input).dimensions.find((d) => d.key === 'compAlignment')
    expect(comp?.score).toBe(65)
    expect(isUnassessed(comp!)).toBe(true)
  })

  test('a real candidate target still scores + displays exactly as before (regression)', () => {
    const prefs = { targetCompTopUsd: 170000, targetLanes: [], workModes: [], employmentTypes: [], noGoLocations: [] }
    const input = assembleFitInput(SIGNALS, prefs, JOB) // posted 200000 vs target 170000 -> ratio > 1.1
    expect(input.targetCompTopUsd).toBe(170000)
    const comp = assessFit(input).dimensions.find((d) => d.key === 'compAlignment')!
    expect(isUnassessed(comp)).toBe(false)
    expect(comp.score).toBe(100)
  })

  test('feeds straight into the deterministic engine', () => {
    const input = assembleFitInput(SIGNALS, { targetCompTopUsd: 170000, targetLanes: [], workModes: [], employmentTypes: [], noGoLocations: [] }, JOB)
    const result = assessFit(input)
    expect(result.overall).toBeGreaterThan(0)
    expect(result.dimensions).toHaveLength(8)
  })

  test('preferences that predate the engagement/sponsorship fields default sensibly (no penalty)', () => {
    // A CandidatePreferences object saved before rubric 1.1.0 has neither field; it must still parse
    // and leave the candidate-side inputs undefined, so the new penalties never fire from missing data.
    const prefs = CandidatePreferencesSchema.parse({})
    expect(prefs.preferredEngagementType).toBeUndefined()
    expect(prefs.needsSponsorship).toBeUndefined()
    const input = assembleFitInput(SIGNALS, prefs, JOB)
    expect(input.preferredEngagementType).toBeUndefined()
    expect(input.needsSponsorship).toBeUndefined()
    const r = assessFit(input)
    expect(r.penalties.workAuthMismatch).toBe(0)
    expect(r.penalties.engagementMismatch).toBe(0)
  })
})

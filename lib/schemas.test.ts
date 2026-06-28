import { describe, expect, test } from 'vitest'
import { CandidatePreferencesSchema } from './schemas'

describe('CandidatePreferencesSchema', () => {
  test('accepts multi-select work modes and employment types', () => {
    const parsed = CandidatePreferencesSchema.parse({
      targetCompTopUsd: 170000,
      targetLanes: ['Cloud Engineer'],
      workModes: ['remote', 'hybrid'],
      employmentTypes: ['full-time', 'contract'],
      noGoLocations: ['California'],
    })
    expect(parsed.workModes).toEqual(['remote', 'hybrid'])
    expect(parsed.employmentTypes).toEqual(['full-time', 'contract'])
  })

  test('contract is a valid employment type (contracting is selectable)', () => {
    expect(CandidatePreferencesSchema.parse({ employmentTypes: ['contract'] }).employmentTypes).toEqual([
      'contract',
    ])
  })

  test('defaults the multi-select arrays to empty when omitted', () => {
    const parsed = CandidatePreferencesSchema.parse({})
    expect(parsed.workModes).toEqual([])
    expect(parsed.employmentTypes).toEqual([])
    expect(parsed.targetLanes).toEqual([])
  })

  test('rejects an unknown work mode / employment type value', () => {
    expect(CandidatePreferencesSchema.safeParse({ workModes: ['spaceship'] }).success).toBe(false)
    expect(CandidatePreferencesSchema.safeParse({ employmentTypes: ['permanent'] }).success).toBe(false)
  })
})

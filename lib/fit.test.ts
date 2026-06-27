import { describe, expect, test } from 'vitest'
import { fitBand, humanizeCode } from '@/lib/fit'

describe('fitBand', () => {
  test('bands by overall score', () => {
    expect(fitBand(90).band).toBe('Strong fit')
    expect(fitBand(75).band).toBe('Strong fit')
    expect(fitBand(74).band).toBe('Solid fit')
    expect(fitBand(55).band).toBe('Solid fit')
    expect(fitBand(54).band).toBe('Stretch fit')
    expect(fitBand(40).band).toBe('Stretch fit')
    expect(fitBand(39).band).toBe('Reach')
    expect(fitBand(0).band).toBe('Reach')
  })

  test('every band carries a non-empty recommendation', () => {
    for (const score of [95, 60, 45, 10]) {
      expect(fitBand(score).recommendation.length).toBeGreaterThan(0)
    }
  })
})

describe('humanizeCode', () => {
  test('turns hyphen/underscore codes into a readable label', () => {
    expect(humanizeCode('strong-domain')).toBe('Strong domain')
    expect(humanizeCode('junior_seniority')).toBe('Junior seniority')
    expect(humanizeCode('exact-skill-match')).toBe('Exact skill match')
  })
})

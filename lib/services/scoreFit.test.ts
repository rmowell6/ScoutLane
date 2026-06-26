import { describe, expect, test } from 'vitest'
import { clampScores } from '@/lib/services/scoreFit'

describe('clampScores', () => {
  test('clamps out-of-range scores into 0..100 and rounds', () => {
    const out = clampScores({
      overall: 142.6,
      subs: [
        { label: 'skills', score: -5, note: 'n' },
        { label: 'experience', score: 87.4, note: 'm' },
      ],
      reasonCodes: ['a'],
    })
    expect(out.overall).toBe(100)
    expect(out.subs[0]?.score).toBe(0)
    expect(out.subs[1]?.score).toBe(87)
  })

  test('passes through in-range scores and preserves reason codes', () => {
    const out = clampScores({ overall: 72, subs: [], reasonCodes: ['strong-domain', 'junior'] })
    expect(out.overall).toBe(72)
    expect(out.reasonCodes).toEqual(['strong-domain', 'junior'])
  })
})

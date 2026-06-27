import { describe, expect, it } from 'vitest'
import { MODELS } from '@/lib/anthropic'

// M0 smoke test: proves the toolchain (Vitest + @/* alias + TS) is wired correctly.
describe('anthropic model constants', () => {
  it('exposes the screen, score, and tailor models', () => {
    expect(MODELS.screen).toBe('claude-haiku-4-5')
    expect(MODELS.score).toBe('claude-sonnet-4-6')
    expect(MODELS.tailor).toBe('claude-sonnet-4-6')
  })
})

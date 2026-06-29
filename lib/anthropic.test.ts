import { describe, expect, it, test } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { MODELS, isTransientAnthropicError } from '@/lib/anthropic'

// M0 smoke test: proves the toolchain (Vitest + @/* alias + TS) is wired correctly.
describe('anthropic model constants', () => {
  it('exposes the screen, score, and tailor models', () => {
    expect(MODELS.screen).toBe('claude-haiku-4-5')
    expect(MODELS.score).toBe('claude-sonnet-4-6')
    expect(MODELS.tailor).toBe('claude-sonnet-4-6')
  })
})

const apiError = (status: number) => new Anthropic.APIError(status, undefined, `status ${status}`, undefined)

describe('isTransientAnthropicError', () => {
  test('429 / 500 / 502 / 503 / 529 are transient', () => {
    for (const s of [429, 500, 502, 503, 529]) {
      expect(isTransientAnthropicError(apiError(s))).toBe(true)
    }
  })

  test('connection / timeout errors are transient', () => {
    expect(isTransientAnthropicError(new Anthropic.APIConnectionError({ message: 'no net' }))).toBe(true)
  })

  test('client errors (400 / 401 / 404 / 422) are NOT transient', () => {
    for (const s of [400, 401, 404, 422]) {
      expect(isTransientAnthropicError(apiError(s))).toBe(false)
    }
  })

  test('a plain logic error is NOT transient', () => {
    expect(isTransientAnthropicError(new Error('truncated JSON'))).toBe(false)
    expect(isTransientAnthropicError(null)).toBe(false)
  })

  test('unwraps a wrapped cause (DiscoverError/PacketError-style)', () => {
    expect(isTransientAnthropicError(new Error("step 'rerank' failed", { cause: apiError(529) }))).toBe(true)
    expect(isTransientAnthropicError(new Error('wrapped', { cause: apiError(400) }))).toBe(false)
  })
})

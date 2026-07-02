import { describe, expect, it, test, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { MODELS, isTransientAnthropicError, logModelUsage } from '@/lib/anthropic'

// M0 smoke test: proves the toolchain (Vitest + @/* alias + TS) is wired correctly.
describe('anthropic model constants', () => {
  it('exposes the screen, score, and tailor models', () => {
    expect(MODELS.screen).toBe('claude-haiku-4-5')
    expect(MODELS.score).toBe('claude-sonnet-5')
    expect(MODELS.tailor).toBe('claude-sonnet-5')
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

describe('logModelUsage', () => {
  const capture = (message: Parameters<typeof logModelUsage>[1]): string => {
    let line = ''
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      line = String(m)
    })
    try {
      logModelUsage('structureResume', message)
    } finally {
      spy.mockRestore()
    }
    return line
  }

  test('emits input, output, thinking, and BOTH prompt-cache token fields (PR #175)', () => {
    const line = capture({
      usage: {
        input_tokens: 1200,
        output_tokens: 800,
        cache_read_input_tokens: 1100,
        cache_creation_input_tokens: 0,
        output_tokens_details: { thinking_tokens: 5 },
      },
    })
    expect(line).toBe('[anthropic] usage structureResume: input=1200 output=800 thinking=5 cacheRead=1100 cacheCreate=0')
  })

  test('total-safe: a missing usage object logs every field as 0', () => {
    expect(capture({ usage: null })).toBe(
      '[anthropic] usage structureResume: input=0 output=0 thinking=0 cacheRead=0 cacheCreate=0',
    )
  })
})

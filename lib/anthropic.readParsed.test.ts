import { describe, expect, test } from 'vitest'
import { readParsed } from '@/lib/anthropic'

describe('readParsed', () => {
  test('returns the parsed output on a normal stop', () => {
    const msg = { stop_reason: 'end_turn', parsed_output: { ok: true } }
    expect(readParsed(msg, 'svc', 2000)).toEqual({ ok: true })
  })

  test('throws an explicit TRUNCATION error when the model hit max_tokens', () => {
    const msg = { stop_reason: 'max_tokens', parsed_output: null }
    expect(() => readParsed(msg, 'structureResume', 4000)).toThrow(/truncated/i)
    expect(() => readParsed(msg, 'structureResume', 4000)).toThrow(/4000/)
  })

  test('prefers the truncation error even if some partial output is present', () => {
    const msg = { stop_reason: 'max_tokens', parsed_output: { partial: true } }
    expect(() => readParsed(msg, 'svc', 1500)).toThrow(/truncated/i)
  })

  test('throws a distinct "no structured output" error when parsed_output is null for other reasons', () => {
    const msg = { stop_reason: 'end_turn', parsed_output: null }
    expect(() => readParsed(msg, 'svc', 2000)).toThrow(/no structured output/i)
  })
})

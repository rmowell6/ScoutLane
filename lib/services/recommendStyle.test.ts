import { afterEach, describe, expect, test, vi } from 'vitest'
import type { JobReqs, Profile } from '@/lib/schemas'

// Mock only the Anthropic layer; the deterministic recommend() runs for real.
const parse = vi.hoisted(() => vi.fn())
const readParsed = vi.hoisted(() => vi.fn())
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { parse } },
  MODELS: { screen: 'claude-haiku-4-5', score: 'x', tailor: 'x' },
  readParsed,
}))

import { recommendStyle } from './recommendStyle'

const PROFILE: Profile = { name: 'A', summary: 's', skills: [], roles: [], certs: [], education: [] }
const JOB: JobReqs = { title: 'Security Engineer', company: 'Acme', mustHave: [], niceToHave: [] }

afterEach(() => {
  parse.mockReset()
  readParsed.mockReset()
})

describe('recommendStyle', () => {
  test('classifies → recommends a style with source "recommended" + a why', async () => {
    parse.mockResolvedValueOnce({})
    readParsed.mockReturnValueOnce({ domain: 'insurance', seniority: 'senior', roleType: 'security' })

    const { style, why } = await recommendStyle(PROFILE, JOB)
    expect(style.source).toBe('recommended')
    expect(typeof style.theme).toBe('string')
    expect(typeof style.font).toBe('string')
    expect(why.length).toBeGreaterThan(0)
  })

  test('no signal → recommender returns the master skin', async () => {
    parse.mockResolvedValueOnce({})
    readParsed.mockReturnValueOnce({ domain: null, seniority: null, roleType: null })

    const { style } = await recommendStyle(PROFILE, JOB)
    expect(style).toMatchObject({ theme: 'navy_copper', font: 'cambria_calibri', source: 'recommended' })
  })

  test('fails soft to the master default when the LLM call throws', async () => {
    parse.mockRejectedValueOnce(new Error('model down'))

    const { style } = await recommendStyle(PROFILE, JOB)
    expect(style).toEqual({ theme: 'navy_copper', font: 'cambria_calibri', source: 'default' })
  })
})

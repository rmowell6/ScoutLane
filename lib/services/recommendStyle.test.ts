import { afterEach, describe, expect, test, vi } from 'vitest'
import type { JobReqs, Profile } from '@/lib/schemas'

// Mock the Anthropic layer (the deterministic recommend() runs for real) and the job-row cache.
const parse = vi.hoisted(() => vi.fn())
const readParsed = vi.hoisted(() => vi.fn())
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { parse } },
  MODELS: { screen: 'claude-haiku-4-5', score: 'x', tailor: 'x' },
  readParsed,
}))
const getJobStyleSignals = vi.hoisted(() => vi.fn(async () => null as unknown))
const saveJobStyleSignals = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./jobStore', () => ({ getJobStyleSignals, saveJobStyleSignals }))

import { recommendStyle } from './recommendStyle'

const PROFILE: Profile = { name: 'A', summary: 's', skills: [], roles: [], certs: [], education: [] }
const JOB: JobReqs = { title: 'Security Engineer', company: 'Acme', mustHave: [], niceToHave: [] }

afterEach(() => {
  parse.mockReset()
  readParsed.mockReset()
  getJobStyleSignals.mockReset()
  getJobStyleSignals.mockResolvedValue(null)
  saveJobStyleSignals.mockReset()
  saveJobStyleSignals.mockResolvedValue(undefined)
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

  describe('job-row cache', () => {
    test('cache HIT: uses cached signals and skips the LLM call', async () => {
      getJobStyleSignals.mockResolvedValueOnce({ domain: 'insurance', seniority: 'senior', roleType: 'security' })

      const { style } = await recommendStyle(PROFILE, JOB, 'job-1')
      expect(getJobStyleSignals).toHaveBeenCalledWith('job-1')
      expect(parse).not.toHaveBeenCalled() // classification skipped
      expect(saveJobStyleSignals).not.toHaveBeenCalled() // nothing new to cache
      expect(style.source).toBe('recommended')
    })

    test('cache MISS: classifies, then writes the result to the job row', async () => {
      getJobStyleSignals.mockResolvedValueOnce(null)
      parse.mockResolvedValueOnce({})
      readParsed.mockReturnValueOnce({ domain: 'insurance', seniority: 'senior', roleType: 'security' })

      await recommendStyle(PROFILE, JOB, 'job-1')
      expect(parse).toHaveBeenCalledOnce()
      expect(saveJobStyleSignals).toHaveBeenCalledWith('job-1', { domain: 'insurance', seniority: 'senior', roleType: 'security' })
    })

    test('a corrupt cached blob is ignored (reclassifies, never crashes)', async () => {
      getJobStyleSignals.mockResolvedValueOnce({ seniority: 'not-a-level' }) // fails schema
      parse.mockResolvedValueOnce({})
      readParsed.mockReturnValueOnce({ domain: null, seniority: null, roleType: null })

      const { style } = await recommendStyle(PROFILE, JOB, 'job-1')
      expect(parse).toHaveBeenCalledOnce()
      expect(style.source).toBe('recommended')
    })

    test('a cache-read error falls through to a fresh classify (never blocks)', async () => {
      getJobStyleSignals.mockRejectedValueOnce(new Error('db down'))
      parse.mockResolvedValueOnce({})
      readParsed.mockReturnValueOnce({ domain: 'insurance', seniority: 'senior', roleType: 'security' })

      const { style } = await recommendStyle(PROFILE, JOB, 'job-1')
      expect(parse).toHaveBeenCalledOnce()
      expect(style.source).toBe('recommended')
    })

    test('no jobId (paste path): no cache read/write', async () => {
      parse.mockResolvedValueOnce({})
      readParsed.mockReturnValueOnce({ domain: 'insurance', seniority: 'senior', roleType: 'security' })

      await recommendStyle(PROFILE, JOB)
      expect(getJobStyleSignals).not.toHaveBeenCalled()
      expect(saveJobStyleSignals).not.toHaveBeenCalled()
    })
  })
})

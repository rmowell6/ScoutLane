import { afterEach, describe, expect, test, vi } from 'vitest'
import { ingestSources } from './index'
import type { AtsSource } from './types'

afterEach(() => vi.unstubAllGlobals())

const GH: AtsSource = { provider: 'greenhouse', token: 'ok-board', company: 'OK Co' }
const ASHBY_BAD: AtsSource = { provider: 'ashby', token: 'missing', company: 'Missing Co' }

describe('ingestSources', () => {
  test('isolates a failing source instead of aborting the whole run', async () => {
    // Greenhouse board resolves; Ashby board 404s. One failure must not sink the other.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('greenhouse')) {
          return { ok: true, status: 200, json: async () => ({ jobs: [{ id: 1, title: 'Eng' }] }) }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }),
    )

    const results = await ingestSources([GH, ASHBY_BAD])
    expect(results).toHaveLength(2)

    const gh = results.find((r) => r.source.provider === 'greenhouse')
    const ashby = results.find((r) => r.source.provider === 'ashby')
    expect(gh?.ok).toBe(true)
    expect(gh?.jobs).toHaveLength(1)
    expect(ashby?.ok).toBe(false)
    expect(ashby?.error).toContain('404')
    expect(ashby?.jobs).toEqual([])
  })
})

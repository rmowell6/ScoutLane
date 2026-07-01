import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AtsSource } from './types'

// Mock the state store + the re-stamp so we can assert the orchestrator's conditional-GET behavior
// without a DB. The store is best-effort in production; here we drive its return values directly.
const { getIngestState, saveIngestState, touchIngestState } = vi.hoisted(() => ({
  getIngestState: vi.fn(),
  saveIngestState: vi.fn(async () => {}),
  touchIngestState: vi.fn(async () => {}),
}))
vi.mock('./ingestState', () => ({ getIngestState, saveIngestState, touchIngestState }))

const { touchJobsValidatedAt } = vi.hoisted(() => ({ touchJobsValidatedAt: vi.fn(async () => 3) }))
vi.mock('@/lib/services/jobStore', () => ({ touchJobsValidatedAt }))

import { ingestSources } from './index'

const GH: AtsSource = { provider: 'greenhouse', token: 'acme', company: 'Acme' }

function stubFetch(res: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async () => res()))
}
function lastRequestHeaders(): Record<string, string> {
  const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
  const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
  return init.headers
}

beforeEach(() => {
  getIngestState.mockReset()
  saveIngestState.mockClear()
  touchIngestState.mockClear()
  touchJobsValidatedAt.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('ingestSources conditional GET', () => {
  test('304 (unchanged): sends If-None-Match, skips parse/upsert, re-stamps rows, stores nothing new', async () => {
    getIngestState.mockResolvedValue({ etag: 'W/"abc"', lastModified: null })
    stubFetch(() => new Response(null, { status: 304 }))

    const [r] = await ingestSources([GH])

    expect(lastRequestHeaders()['if-none-match']).toBe('W/"abc"')
    expect(r?.ok).toBe(true)
    expect(r?.notModified).toBe(true)
    expect(r?.jobs).toEqual([]) // nothing parsed/upserted
    // The board's live rows are re-stamped so the per-provider expiry can't age them out.
    expect(touchJobsValidatedAt).toHaveBeenCalledWith('greenhouse', 'Acme', expect.any(String))
    expect(touchIngestState).toHaveBeenCalledWith('greenhouse:acme')
    expect(saveIngestState).not.toHaveBeenCalled() // validators unchanged on a 304
  })

  test('first run (no stored etag): unconditional fetch, parses, stores the returned validators', async () => {
    getIngestState.mockResolvedValue(null)
    stubFetch(
      () =>
        new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Eng' }] }), {
          status: 200,
          headers: { etag: 'W/"v1"', 'last-modified': 'Wed, 01 Jul 2026 00:00:00 GMT' },
        }),
    )

    const [r] = await ingestSources([GH])

    expect(lastRequestHeaders()['if-none-match']).toBeUndefined() // no validator to send
    expect(r?.ok).toBe(true)
    expect(r?.notModified).toBeUndefined()
    expect(r?.jobs).toHaveLength(1)
    expect(saveIngestState).toHaveBeenCalledWith('greenhouse:acme', {
      etag: 'W/"v1"',
      lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT',
    })
    expect(touchJobsValidatedAt).not.toHaveBeenCalled() // full path re-stamps via the upsert, not here
  })

  test('changed etag: fetches with the old validator, parses, stores the new validator', async () => {
    getIngestState.mockResolvedValue({ etag: 'W/"old"', lastModified: null })
    stubFetch(
      () => new Response(JSON.stringify({ jobs: [{ id: 2, title: 'SRE' }] }), { status: 200, headers: { etag: 'W/"new"' } }),
    )

    const [r] = await ingestSources([GH])

    expect(lastRequestHeaders()['if-none-match']).toBe('W/"old"')
    expect(r?.jobs).toHaveLength(1)
    expect(saveIngestState).toHaveBeenCalledWith('greenhouse:acme', { etag: 'W/"new"', lastModified: null })
  })

  test('a re-stamp failure on 304 conservatively reports the source not-ok (rows never wrongly expired)', async () => {
    getIngestState.mockResolvedValue({ etag: 'W/"abc"', lastModified: null })
    stubFetch(() => new Response(null, { status: 304 }))
    touchJobsValidatedAt.mockRejectedValueOnce(new Error('db down'))

    const [r] = await ingestSources([GH])

    // Not-ok drops the provider from the prune set, so its live rows are safe rather than aged out.
    expect(r?.ok).toBe(false)
    expect(r?.jobs).toEqual([])
    expect(r?.error).toContain('db down')
  })
})

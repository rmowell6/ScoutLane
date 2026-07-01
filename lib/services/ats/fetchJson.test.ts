import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchJson, fetchJsonConditional } from './fetchJson'

function stub(res: Response | (() => Response)) {
  vi.stubGlobal('fetch', vi.fn(async () => (typeof res === 'function' ? res() : res)))
}

function lastRequestInit(): { headers: Record<string, string> } {
  const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
  return fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchJson', () => {
  test('parses a JSON body via the streamed read', async () => {
    stub(new Response(JSON.stringify({ jobs: [{ id: 1 }] }), { status: 200 }))
    expect(await fetchJson('https://x/api')).toEqual({ jobs: [{ id: 1 }] })
  })

  test('throws a readable error on non-2xx', async () => {
    stub(new Response('nope', { status: 404 }))
    await expect(fetchJson('https://x/api')).rejects.toThrow(/HTTP 404/)
  })

  test('rejects a body advertised over the byte cap (Content-Length)', async () => {
    stub(() => new Response('{}', { status: 200, headers: { 'content-length': '999999' } }))
    await expect(fetchJson('https://x/api', 10_000, 1000)).rejects.toThrow(/too large/)
  })

  test('aborts a stream that exceeds the byte cap mid-read', async () => {
    // No/last-resort Content-Length: the cap must still bite as bytes arrive.
    const big = JSON.stringify({ blob: 'y'.repeat(5000) })
    stub(new Response(big, { status: 200 }))
    await expect(fetchJson('https://x/api', 10_000, 1000)).rejects.toThrow(/too large/)
  })
})

describe('fetchJsonConditional', () => {
  test('returns not-modified on a 304 (no body read)', async () => {
    stub(new Response(null, { status: 304 }))
    expect(await fetchJsonConditional('https://x/api', { etag: 'W/"a"' })).toEqual({ status: 'not-modified' })
  })

  test('on 200 returns the parsed body plus the response validators', async () => {
    stub(
      new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { etag: 'W/"v1"', 'last-modified': 'Wed, 01 Jul 2026 00:00:00 GMT' },
      }),
    )
    expect(await fetchJsonConditional('https://x/api')).toEqual({
      status: 'ok',
      data: { jobs: [] },
      etag: 'W/"v1"',
      lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT',
    })
  })

  test('sends If-None-Match / If-Modified-Since only when validators are provided', async () => {
    stub(new Response('{}', { status: 200 }))
    await fetchJsonConditional('https://x/api', { etag: 'W/"a"', lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT' })
    const headers = lastRequestInit().headers
    expect(headers['if-none-match']).toBe('W/"a"')
    expect(headers['if-modified-since']).toBe('Wed, 01 Jul 2026 00:00:00 GMT')
  })

  test('omits conditional headers when no validators are held', async () => {
    stub(new Response('{}', { status: 200 }))
    await fetchJsonConditional('https://x/api')
    const headers = lastRequestInit().headers
    expect(headers['if-none-match']).toBeUndefined()
    expect(headers['if-modified-since']).toBeUndefined()
  })

  test('still throws a readable error on a non-304 non-2xx', async () => {
    stub(new Response('nope', { status: 500 }))
    await expect(fetchJsonConditional('https://x/api', { etag: 'W/"a"' })).rejects.toThrow(/HTTP 500/)
  })
})

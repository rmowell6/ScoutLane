import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchJson } from './fetchJson'

function stub(res: Response | (() => Response)) {
  vi.stubGlobal('fetch', vi.fn(async () => (typeof res === 'function' ? res() : res)))
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

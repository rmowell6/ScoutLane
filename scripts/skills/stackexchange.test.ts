import { describe, expect, test, vi } from 'vitest'
import { collectStackExchangeCandidates, type FetchLike } from './stackexchange'

// Canned API responses keyed by URL path, so the mock returns tag-info counts for /info and synonym
// pairs for /synonyms. No live network, matches the two verified endpoint shapes.
function mockFetch(): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetchImpl: FetchLike = async (url: string) => {
    calls.push(url)
    let body: unknown
    if (url.includes('/info')) {
      body = { items: [{ name: 'kubernetes', count: 40000 }, { name: 'reactjs', count: 450000 }] }
    } else if (url.includes('/synonyms')) {
      body = {
        items: [
          { from_tag: 'k8s', to_tag: 'kubernetes', applied_count: 1124 },
          { from_tag: 'react.js', to_tag: 'reactjs', applied_count: 1469 },
        ],
        has_more: false,
      }
    } else {
      body = { items: [] }
    }
    return { ok: true, status: 200, json: async () => body }
  }
  return { fetchImpl, calls }
}

describe('collectStackExchangeCandidates', () => {
  const noSleep = async () => {}

  test('maps synonyms to candidates with the canonical tag question count', async () => {
    const { fetchImpl } = mockFetch()
    const candidates = await collectStackExchangeCandidates(['kubernetes', 'reactjs'], { fetchImpl, sleep: noSleep })

    expect(candidates).toEqual([
      { source: 'stackexchange', fromTag: 'k8s', toTag: 'kubernetes', appliedCount: 1124, questionCount: 40000 },
      { source: 'stackexchange', fromTag: 'react.js', toTag: 'reactjs', appliedCount: 1469, questionCount: 450000 },
    ])
  })

  test('sends a semicolon-delimited tag vector and hits both endpoints', async () => {
    const { fetchImpl, calls } = mockFetch()
    await collectStackExchangeCandidates(['kubernetes', 'reactjs'], { fetchImpl, sleep: noSleep })

    expect(calls.some((u) => u.includes('/info?'))).toBe(true)
    expect(calls.some((u) => u.includes('/synonyms?'))).toBe(true)
    // Tags are joined by an (encoded) semicolon in the path.
    expect(calls.some((u) => u.includes('kubernetes;reactjs') || u.includes('kubernetes%3Breactjs'))).toBe(true)
  })

  test('question count is null when the canonical tag was not in the info response', async () => {
    const fetchImpl: FetchLike = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/synonyms')
          ? { items: [{ from_tag: 'gtk3', to_tag: 'gtk', applied_count: 10 }], has_more: false }
          : { items: [] }, // /info returns nothing for these tags
    })
    const candidates = await collectStackExchangeCandidates(['gtk'], { fetchImpl, sleep: noSleep })
    expect(candidates).toEqual([
      { source: 'stackexchange', fromTag: 'gtk3', toTag: 'gtk', appliedCount: 10, questionCount: null },
    ])
  })

  test('throws on a non-ok HTTP response', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 502, json: async () => ({}) })
    await expect(collectStackExchangeCandidates(['kubernetes'], { fetchImpl, sleep: noSleep })).rejects.toThrow(/HTTP 502/)
  })

  test('honors a backoff value from the API (awaits the returned seconds)', async () => {
    const sleep = vi.fn(async () => {})
    let first = true
    const fetchImpl: FetchLike = async (url) => {
      const body =
        url.includes('/info') && first
          ? ((first = false), { items: [{ name: 'kubernetes', count: 40000 }], backoff: 2 })
          : url.includes('/synonyms')
            ? { items: [{ from_tag: 'k8s', to_tag: 'kubernetes', applied_count: 1124 }], has_more: false }
            : { items: [{ name: 'kubernetes', count: 40000 }] }
      return { ok: true, status: 200, json: async () => body }
    }
    await collectStackExchangeCandidates(['kubernetes'], { fetchImpl, sleep })
    expect(sleep).toHaveBeenCalledWith(2000) // backoff seconds -> ms
  })
})

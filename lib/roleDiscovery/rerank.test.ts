import { describe, expect, test } from 'vitest'
import { assembleDiscoveries } from './rerank'
import type { ScoredJob } from './prefilter'

function candidate(id: string, title = 'Role'): ScoredJob {
  return {
    id,
    provider: 'lever',
    title,
    company: 'Co',
    location: null,
    url: `u/${id}`,
    snippet: '',
    lexScore: 1,
    hits: [],
  }
}

const CANDIDATES: ScoredJob[] = [candidate('a', 'Platform Engineer'), candidate('b', 'SRE'), candidate('c', 'Cloud Eng')]

describe('assembleDiscoveries', () => {
  test('rejoins model verdicts with real postings, sorts by score desc, caps at topN', () => {
    const ranked = {
      roles: [
        { id: 'b', score: 70.4, reason: 'reliability work' },
        { id: 'a', score: 92.8, reason: 'same stack, different title' },
        { id: 'c', score: 55, reason: 'partial overlap' },
      ],
    }
    const out = assembleDiscoveries(ranked, CANDIDATES, 2)
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
    expect(out[0]!.score).toBe(93) // rounded
    expect(out[0]!.title).toBe('Platform Engineer') // real posting data, not from the model
    expect(out[0]!.url).toBe('u/a')
  })

  test('drops hallucinated ids the model invented', () => {
    const ranked = { roles: [{ id: 'ghost', score: 99, reason: 'made up' }, { id: 'a', score: 80, reason: 'real' }] }
    const out = assembleDiscoveries(ranked, CANDIDATES, 5)
    expect(out.map((r) => r.id)).toEqual(['a'])
  })

  test('de-dupes a repeated id, keeping the first occurrence', () => {
    const ranked = { roles: [{ id: 'a', score: 90, reason: 'first' }, { id: 'a', score: 10, reason: 'dupe' }] }
    const out = assembleDiscoveries(ranked, CANDIDATES, 5)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe('first')
  })
})

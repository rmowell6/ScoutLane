import { describe, expect, test } from 'vitest'
import { deduplicateJobs } from './aggregator'
import type { Job } from './types'

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'arbeitnow:1',
    source: 'arbeitnow',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'NYC',
    remote: false,
    type: 'full-time',
    description: '',
    tags: [],
    url: 'https://x/jobs/1',
    postedAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  }
}

describe('deduplicateJobs', () => {
  test('same URL from two providers collapses to ONE job, keeping the higher-priority source', () => {
    // Regression for vendored-40: the old set-intersection dropped BOTH copies.
    const out = deduplicateJobs([
      job({ source: 'arbeitnow', url: 'https://board/jobs/9' }),
      job({ source: 'jsearch', url: 'https://board/jobs/9' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.source).toBe('jsearch') // jsearch outranks arbeitnow
  })

  test('result is order-invariant (same URL, reversed arrival → same winner)', () => {
    const out = deduplicateJobs([
      job({ source: 'jsearch', url: 'https://board/jobs/9' }),
      job({ source: 'arbeitnow', url: 'https://board/jobs/9' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.source).toBe('jsearch')
  })

  test('ignores query strings when comparing URLs', () => {
    const out = deduplicateJobs([
      job({ source: 'arbeitnow', url: 'https://board/jobs/9?utm=a' }),
      job({ source: 'jsearch', url: 'https://board/jobs/9?ref=b' }),
    ])
    expect(out).toHaveLength(1)
  })

  test('two DISTINCT jobs sharing title+company but different URLs both survive', () => {
    // Regression for vendored-41: the old fuzzy pass over-merged these.
    const out = deduplicateJobs([
      job({ id: 'jsearch:nyc', url: 'https://board/jobs/nyc-123' }),
      job({ id: 'jsearch:sf', url: 'https://board/jobs/sf-456' }),
    ])
    expect(out).toHaveLength(2)
  })

  test('a url-less job never annihilates other jobs', () => {
    const out = deduplicateJobs([
      job({ id: 'x:1', url: '' }),
      job({ id: 'x:2', url: 'https://board/jobs/2' }),
    ])
    expect(out).toHaveLength(2)
  })

  test('genuinely distinct postings are all kept', () => {
    const out = deduplicateJobs([
      job({ url: 'https://board/a' }),
      job({ url: 'https://board/b' }),
      job({ url: 'https://board/c' }),
    ])
    expect(out).toHaveLength(3)
  })
})

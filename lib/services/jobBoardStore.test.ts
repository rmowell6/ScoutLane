import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toJobBoardRow, dedupeRows, isStorableJob, upsertJobBoardJobs, type JobBoardRow } from './jobBoardStore'
import type { Job } from '@/src/jobBoards/types'

// Records every .upsert() batch so the chunking tests can assert batch sizes without a live DB.
const state = vi.hoisted(() => ({ upserts: [] as Array<{ rows: unknown[]; opts: unknown }> }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: (rows: unknown[], opts: unknown) => {
        state.upserts.push({ rows, opts })
        return Promise.resolve({ data: null, error: null, count: null })
      },
    }),
  }),
}))

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'jsearch:abc123',
    source: 'jsearch',
    title: 'Cloud Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: false,
    type: 'full-time',
    description: 'Build cloud things.',
    tags: ['azure'],
    url: 'https://x/jobs/1',
    postedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
}

const NOW = '2026-06-28T00:00:00Z'

describe('toJobBoardRow', () => {
  test('maps a Job to the shared row shape, splitting id into source + external_id', () => {
    const row = toJobBoardRow(job(), NOW)
    expect(row).toEqual<JobBoardRow>({
      source: 'jsearch',
      external_id: 'abc123',
      title: 'Cloud Engineer',
      company: 'Acme',
      location: 'Austin, TX',
      url: 'https://x/jobs/1',
      jd_raw: 'Build cloud things.',
      status: 'live',
      validated_at: NOW,
    })
  })

  test('keeps everything after the FIRST colon as external_id (ids can contain colons)', () => {
    const row = toJobBoardRow(job({ id: 'remoteok:https://r.ok/jobs/9:42' }), NOW)
    expect(row.external_id).toBe('https://r.ok/jobs/9:42')
  })

  test('falls back to the whole id when there is no colon', () => {
    expect(toJobBoardRow(job({ id: 'plainid' }), NOW).external_id).toBe('plainid')
  })

  test('coerces blank/whitespace location to null', () => {
    expect(toJobBoardRow(job({ location: '   ' }), NOW).location).toBeNull()
    expect(toJobBoardRow(job({ location: ' Remote ' }), NOW).location).toBe('Remote')
  })

  test('caps an oversized description', () => {
    const row = toJobBoardRow(job({ description: 'x'.repeat(80_000) }), NOW)
    expect(row.jd_raw.length).toBe(60_000)
  })
})

describe('isStorableJob', () => {
  test('accepts a job with url, title, and source', () => {
    expect(isStorableJob(job())).toBe(true)
  })
  test('rejects jobs missing url or title (malformed provider output)', () => {
    expect(isStorableJob(job({ url: '' }))).toBe(false)
    expect(isStorableJob(job({ url: undefined as never }))).toBe(false)
    expect(isStorableJob(job({ title: '   ' }))).toBe(false)
  })
})

describe('dedupeRows', () => {
  test('collapses rows sharing (source, external_id), keeping the last', () => {
    const a = toJobBoardRow(job({ id: 'jsearch:1', title: 'First' }), NOW)
    const b = toJobBoardRow(job({ id: 'jsearch:1', title: 'Second' }), NOW)
    const c = toJobBoardRow(job({ id: 'adzuna:1', source: 'adzuna' }), NOW)
    const out = dedupeRows([a, b, c])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.source === 'jsearch' && r.external_id === '1')?.title).toBe('Second')
  })
})

describe('upsertJobBoardJobs chunking', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret'
    state.upserts = []
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SECRET_KEY
  })

  test('a small set issues exactly one upsert (behavior unchanged at normal scale)', async () => {
    await upsertJobBoardJobs([job(), job({ id: 'jsearch:2', url: 'https://x/jobs/2' })], NOW)
    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0]?.opts).toMatchObject({ onConflict: 'source,external_id' })
  })

  test('chunks a large set into 500-row upserts, writing every row (after dedupe)', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => job({ id: `jsearch:${i}`, url: `https://x/jobs/${i}` }))
    const n = await upsertJobBoardJobs(many, NOW)
    // 1200 unique rows / 500 -> 3 batches of 500, 500, 200.
    expect(state.upserts.map((u) => u.rows.length)).toEqual([500, 500, 200])
    const ids = state.upserts.flatMap((u) => (u.rows as Array<{ external_id: string }>).map((r) => r.external_id))
    expect(new Set(ids).size).toBe(1200) // no row dropped or duplicated by chunking
    expect(n).toBe(1200) // sum of per-batch counts
  })
})

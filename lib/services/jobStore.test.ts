import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { IngestedJob } from '@/lib/services/ats/types'

// Chainable mock of the PostgREST query builder. Records calls so we can assert the search
// filter, and resolves to a preset result when awaited / on terminal calls.
const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown, count: null as number | null },
  calls: [] as unknown[][],
}))

function makeQuery() {
  const q: Record<string, unknown> = {
    select: (...a: unknown[]) => (state.calls.push(['select', ...a]), q),
    eq: (...a: unknown[]) => (state.calls.push(['eq', ...a]), q),
    or: (...a: unknown[]) => (state.calls.push(['or', ...a]), q),
    order: (...a: unknown[]) => (state.calls.push(['order', ...a]), q),
    limit: (...a: unknown[]) => (state.calls.push(['limit', ...a]), q),
    // Mutating builders are chainable and resolved via the thenable `then` below (terminal await).
    update: (...a: unknown[]) => (state.calls.push(['update', ...a]), q),
    delete: (...a: unknown[]) => (state.calls.push(['delete', ...a]), q),
    in: (...a: unknown[]) => (state.calls.push(['in', ...a]), q),
    lt: (...a: unknown[]) => (state.calls.push(['lt', ...a]), q),
    upsert: (...a: unknown[]) => {
      state.calls.push(['upsert', ...a])
      return Promise.resolve(state.result)
    },
    maybeSingle: () => Promise.resolve(state.result),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(state.result).then(onF, onR),
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => makeQuery() }) }))

import {
  expireStaleJobs,
  getJobJd,
  getPoolStats,
  isJobStoreConfigured,
  listJobs,
  reclaimExpiredJobs,
  upsertJobs,
} from './jobStore'

const JOB: IngestedJob = {
  provider: 'greenhouse',
  externalId: 'gh-1',
  title: 'Cloud Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://x/jobs/1',
  jdText: 'Build cloud things.',
}

function findCall(name: string): unknown[] | undefined {
  return state.calls.find((c) => c[0] === name)
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
  state.result = { data: null, error: null, count: null }
  state.calls = []
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
})

describe('isJobStoreConfigured', () => {
  test('reflects presence of secrets', () => {
    expect(isJobStoreConfigured()).toBe(true)
    delete process.env.SUPABASE_SECRET_KEY
    expect(isJobStoreConfigured()).toBe(false)
  })
})

describe('listJobs', () => {
  test('maps rows to the light StoredJob shape', async () => {
    state.result = {
      data: [
        { id: 'a', source: 'lever', title: 'SRE', company: 'Acme', location: 'NYC', url: 'u' },
        { id: 'b', source: 'ashby', title: 'Eng', company: 'Beta', location: null, url: '' },
      ],
      error: null,
      count: null,
    }
    const jobs = await listJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({ id: 'a', provider: 'lever', title: 'SRE', company: 'Acme', location: 'NYC', url: 'u' })
    expect(findCall('or')).toBeUndefined() // no search term -> no filter
  })

  test('applies an escaped title/company search when q is given', async () => {
    state.result = { data: [], error: null, count: null }
    await listJobs({ q: 'senior, eng (c++)' })
    const or = findCall('or')
    expect(or).toBeDefined()
    const filter = String(or?.[1])
    expect(filter).toContain('title.ilike.')
    expect(filter).toContain('company.ilike.')
    // commas/parens/percent are neutralized so they can't break the .or() grammar
    expect(filter).not.toContain(',eng')
    expect(filter).not.toContain('(c++)')
  })

  test('neutralizes every .or()/ILIKE metacharacter', async () => {
    state.result = { data: [], error: null, count: null }
    await listJobs({ q: 'a%b_c*d,e(f)g\\h"i' })
    const filter = String(findCall('or')?.[1])
    // capture just the user-supplied term inside the title ILIKE pattern
    const term = /title\.ilike\.%(.*?)%,company/.exec(filter)?.[1] ?? ''
    expect(term).toBe('a b c d e f g h i') // every metachar collapsed to a space
    for (const ch of ['%', '_', '*', ',', '(', ')', '\\', '"']) {
      expect(term).not.toContain(ch)
    }
  })

  test('caps an overlong search term', async () => {
    state.result = { data: [], error: null, count: null }
    await listJobs({ q: 'x'.repeat(5000) })
    const filter = String(findCall('or')?.[1])
    // 100-char cap applied to each ILIKE side (plus the fixed wrapper text)
    expect(filter.length).toBeLessThan(260)
  })

  test('surfaces a DB error tagged with step "list"', async () => {
    state.result = { data: null, error: new Error('boom'), count: null }
    await expect(listJobs()).rejects.toMatchObject({ name: 'JobStoreError', step: 'list' })
  })
})

describe('upsertJobs', () => {
  test('returns 0 without touching the DB for an empty list', async () => {
    const n = await upsertJobs([], '2026-06-27T00:00:00Z')
    expect(n).toBe(0)
    expect(state.calls).toHaveLength(0)
  })

  test('upserts mapped rows on (source, external_id) and returns the count', async () => {
    state.result = { data: null, error: null, count: 1 }
    const n = await upsertJobs([JOB], '2026-06-27T00:00:00Z')
    expect(n).toBe(1)
    const up = findCall('upsert')
    expect(up).toBeDefined()
    const rows = up?.[1] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({
      source: 'greenhouse',
      external_id: 'gh-1',
      title: 'Cloud Engineer',
      jd_raw: 'Build cloud things.',
      status: 'live',
    })
    expect(up?.[2]).toMatchObject({ onConflict: 'source,external_id' })
  })
})

describe('expireStaleJobs', () => {
  test('returns 0 without touching the DB when the prunable source list is empty', async () => {
    const n = await expireStaleJobs([], '2026-06-14T00:00:00Z')
    expect(n).toBe(0)
    expect(state.calls).toHaveLength(0)
  })

  test('soft-expires only live rows of the given sources older than the cutoff', async () => {
    state.result = { data: null, error: null, count: 3 }
    const n = await expireStaleJobs(['greenhouse', 'jsearch'], '2026-06-14T00:00:00Z')
    expect(n).toBe(3)
    // update sets status='expired'; scoped by status='live', source IN (...), validated_at < cutoff
    const update = findCall('update')
    expect(update?.[1]).toEqual({ status: 'expired' })
    expect(update?.[2]).toMatchObject({ count: 'exact' })
    expect(findCall('eq')).toEqual(['eq', 'status', 'live'])
    expect(findCall('in')).toEqual(['in', 'source', ['greenhouse', 'jsearch']])
    expect(findCall('lt')).toEqual(['lt', 'validated_at', '2026-06-14T00:00:00Z'])
  })

  test('tags a DB error with step "expire"', async () => {
    state.result = { data: null, error: new Error('boom'), count: null }
    await expect(expireStaleJobs(['greenhouse'], '2026-06-14T00:00:00Z')).rejects.toMatchObject({
      name: 'JobStoreError',
      step: 'expire',
    })
  })
})

describe('reclaimExpiredJobs', () => {
  test('deletes only already-expired rows older than the (longer) reclaim cutoff', async () => {
    state.result = { data: null, error: null, count: 2 }
    const n = await reclaimExpiredJobs('2026-05-29T00:00:00Z')
    expect(n).toBe(2)
    expect(findCall('delete')).toBeDefined()
    expect(findCall('eq')).toEqual(['eq', 'status', 'expired'])
    expect(findCall('lt')).toEqual(['lt', 'validated_at', '2026-05-29T00:00:00Z'])
  })

  test('tags a DB error with step "reclaim"', async () => {
    state.result = { data: null, error: new Error('boom'), count: null }
    await expect(reclaimExpiredJobs('2026-05-29T00:00:00Z')).rejects.toMatchObject({
      name: 'JobStoreError',
      step: 'reclaim',
    })
  })
})

describe('getPoolStats', () => {
  test('reports the live count and the most recent validated_at', async () => {
    state.result = { data: { validated_at: '2026-06-28T03:00:00Z' }, error: null, count: 42 }
    const stats = await getPoolStats()
    expect(stats).toEqual({ live: 42, lastIngestAt: '2026-06-28T03:00:00Z' })
    expect(findCall('eq')).toEqual(['eq', 'status', 'live'])
  })

  test('returns 0 / null on an empty pool', async () => {
    state.result = { data: null, error: null, count: 0 }
    expect(await getPoolStats()).toEqual({ live: 0, lastIngestAt: null })
  })
})

describe('getJobJd', () => {
  test('returns the full job incl. jd text', async () => {
    state.result = { data: { id: 'j1', title: 'SRE', company: 'Acme', jd_raw: 'Do SRE.' }, error: null, count: null }
    expect(await getJobJd('j1')).toEqual({ id: 'j1', title: 'SRE', company: 'Acme', jdText: 'Do SRE.' })
  })

  test('returns null when not found', async () => {
    state.result = { data: null, error: null, count: null }
    expect(await getJobJd('missing')).toBeNull()
  })

  test('coerces null title/company/jd_raw to empty strings', async () => {
    state.result = { data: { id: 'j1', title: null, company: null, jd_raw: null }, error: null, count: null }
    expect(await getJobJd('j1')).toEqual({ id: 'j1', title: '', company: '', jdText: '' })
  })

  test('rejects a stored row whose shape is invalid (id missing)', async () => {
    state.result = { data: { title: 'SRE', jd_raw: 'x' }, error: null, count: null }
    await expect(getJobJd('j1')).rejects.toMatchObject({ name: 'JobStoreError', step: 'get' })
  })
})

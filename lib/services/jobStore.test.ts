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
  listJobsForMatch,
  reclaimExpiredJobs,
  touchJobsValidatedAt,
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

  test('drops clearly-non-US postings by default (US work-auth assumption)', async () => {
    state.result = {
      data: [
        { id: 'us1', source: 'lever', title: 'SRE', company: 'Acme', location: 'Austin, TX', url: 'u' },
        { id: 'de1', source: 'arbeitnow', title: 'Eng (m/w/d)', company: 'Cyrus', location: 'Munich', url: 'u' },
        { id: 'rem', source: 'remotive', title: 'Dev', company: 'Beta', location: 'Remote', url: 'u' },
      ],
      error: null,
      count: null,
    }
    const jobs = await listJobs()
    // Munich (clearly non-US) dropped; Austin (US) and Remote/unknown (bias toward keeping) survive.
    expect(jobs.map((j) => j.id)).toEqual(['us1', 'rem'])
  })

  test('usOnly:false keeps international postings', async () => {
    state.result = {
      data: [{ id: 'de1', source: 'arbeitnow', title: 'Eng', company: 'Cyrus', location: 'Munich', url: 'u' }],
      error: null,
      count: null,
    }
    const jobs = await listJobs({ usOnly: false })
    expect(jobs.map((j) => j.id)).toEqual(['de1'])
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

describe('listJobsForMatch', () => {
  test('selects jd_snippet (never the full jd_raw body) and maps it to snippet', async () => {
    state.result = {
      data: [
        { id: 'j1', source: 'lever', title: 'SRE', company: 'Acme', location: 'NYC', url: 'u', jd_snippet: 'Run reliable systems.' },
      ],
      error: null,
      count: null,
    }
    const jobs = await listJobsForMatch()
    // The overfetch fix: the read must pull the pre-truncated column, not the whole JD body.
    const select = String(findCall('select')?.[1])
    expect(select).toContain('jd_snippet')
    expect(select).not.toContain('jd_raw')
    expect(jobs[0]).toEqual({
      id: 'j1',
      provider: 'lever',
      title: 'SRE',
      company: 'Acme',
      location: 'NYC',
      url: 'u',
      snippet: 'Run reliable systems.',
    })
  })

  test('coerces a null/missing jd_snippet (and other columns) to safe defaults', async () => {
    state.result = {
      data: [{ id: 'j2', source: null, title: null, company: null, location: null, url: null, jd_snippet: null }],
      error: null,
      count: null,
    }
    const jobs = await listJobsForMatch()
    expect(jobs[0]).toEqual({
      id: 'j2',
      provider: 'unknown',
      title: 'Untitled role',
      company: '',
      location: null,
      url: '',
      snippet: '',
    })
  })

  test('passes the DB snippet through unchanged (600-char cap now lives in the jd_snippet column)', async () => {
    // The 600-char truncation moved from a client-side .slice(0, 600) to the jobs.jd_snippet generated
    // column (left(jd_raw, 600), migration 0017), so a snippet the DB already capped at 600 chars must
    // reach the pre-filter untouched. left(text, 600) matches .slice(0, 600) for JD text; exercising
    // the SQL truncation itself needs a live DB, so this asserts the pass-through the app relies on.
    const capped = 'x'.repeat(600)
    state.result = {
      data: [{ id: 'j3', source: 'lever', title: 'T', company: 'C', location: null, url: 'u', jd_snippet: capped }],
      error: null,
      count: null,
    }
    const jobs = await listJobsForMatch()
    expect(jobs[0]?.snippet).toBe(capped)
    expect(jobs[0]?.snippet.length).toBe(600)
  })

  test('tags a DB error with step "listForMatch"', async () => {
    state.result = { data: null, error: new Error('boom'), count: null }
    await expect(listJobsForMatch()).rejects.toMatchObject({ name: 'JobStoreError', step: 'listForMatch' })
  })
})

describe('upsertJobs', () => {
  test('returns 0 without touching the DB for an empty list', async () => {
    const n = await upsertJobs([], '2026-06-27T00:00:00Z')
    expect(n).toBe(0)
    expect(state.calls).toHaveLength(0)
  })

  test('drops clearly-non-US jobs before writing (US-market only)', async () => {
    state.result = { data: null, error: null, count: 1 }
    const munich: IngestedJob = { ...JOB, externalId: 'de-1', location: 'Munich, Germany' }
    await upsertJobs([JOB, munich], '2026-06-27T00:00:00Z')
    const rows = findCall('upsert')?.[1] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1) // only the US/Remote job is written
    expect(rows[0]?.external_id).toBe('gh-1')
  })

  test('writes nothing (no DB call) when every job is clearly non-US', async () => {
    const n = await upsertJobs([{ ...JOB, location: 'Berlin, Germany' }], '2026-06-27T00:00:00Z')
    expect(n).toBe(0)
    expect(findCall('upsert')).toBeUndefined()
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

  test('a single small batch still issues exactly one upsert (behavior unchanged at normal scale)', async () => {
    state.result = { data: null, error: null, count: 3 }
    await upsertJobs([JOB, { ...JOB, externalId: 'gh-2' }, { ...JOB, externalId: 'gh-3' }], '2026-06-27T00:00:00Z')
    expect(state.calls.filter((c) => c[0] === 'upsert')).toHaveLength(1)
  })

  test('chunks a large row set into 500-row upserts, writing every row', async () => {
    state.result = { data: null, error: null, count: null } // fall back to batch.length per batch
    const big = Array.from({ length: 1200 }, (_, i) => ({ ...JOB, externalId: `gh-${i}` }))
    const n = await upsertJobs(big, '2026-06-27T00:00:00Z')
    const upserts = state.calls.filter((c) => c[0] === 'upsert')
    // 1200 rows / 500 -> 3 batches of 500, 500, 200.
    expect(upserts.map((c) => (c[1] as unknown[]).length)).toEqual([500, 500, 200])
    // Every external_id was sent for upsert exactly once (no row dropped or duplicated by chunking).
    const ids = upserts.flatMap((c) => (c[1] as Array<{ external_id: string }>).map((r) => r.external_id))
    expect(new Set(ids).size).toBe(1200)
    expect(n).toBe(1200) // sum of per-batch counts
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

describe('touchJobsValidatedAt', () => {
  test('re-stamps validated_at for one board (source+company) live rows and returns the count', async () => {
    state.result = { data: null, error: null, count: 3 }
    const n = await touchJobsValidatedAt('greenhouse', 'Acme', '2026-07-01T00:00:00Z')
    expect(n).toBe(3)
    const update = findCall('update')
    expect(update?.[1]).toEqual({ validated_at: '2026-07-01T00:00:00Z' })
    // Scoped to LIVE rows of exactly this provider + company (the one board that returned 304).
    const eqs = state.calls.filter((c) => c[0] === 'eq')
    expect(eqs).toContainEqual(['eq', 'status', 'live'])
    expect(eqs).toContainEqual(['eq', 'source', 'greenhouse'])
    expect(eqs).toContainEqual(['eq', 'company', 'Acme'])
  })

  test('tags a DB error with step "touchValidatedAt"', async () => {
    state.result = { data: null, error: new Error('boom'), count: null }
    await expect(touchJobsValidatedAt('greenhouse', 'Acme', '2026-07-01T00:00:00Z')).rejects.toMatchObject({
      name: 'JobStoreError',
      step: 'touchValidatedAt',
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

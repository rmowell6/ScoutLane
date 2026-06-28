import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Chainable mock of the PostgREST builder: upsert(...).select(...) resolves to a preset result.
const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  calls: [] as unknown[][],
}))

function makeQuery() {
  const q: Record<string, unknown> = {
    upsert: (...a: unknown[]) => (state.calls.push(['upsert', ...a]), q),
    select: (...a: unknown[]) => {
      state.calls.push(['select', ...a])
      return Promise.resolve(state.result)
    },
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => makeQuery() }) }))

import { apifyRunKey, claimApifyRun } from './apifyRunLock'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
  state.result = { data: null, error: null }
  state.calls = []
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
})

describe('apifyRunKey', () => {
  test('keys by UTC date (matches isApifyDay getUTCDate)', () => {
    expect(apifyRunKey('2026-06-21T03:00:00.000Z')).toBe('apify:2026-06-21')
  })
})

describe('claimApifyRun', () => {
  test('returns true when the insert wins the day (one row returned)', async () => {
    state.result = { data: [{ run_key: 'apify:2026-06-21' }], error: null }
    expect(await claimApifyRun('2026-06-21T03:00:00.000Z')).toBe(true)
    // ON CONFLICT DO NOTHING semantics: ignoreDuplicates on the run_key conflict target
    const upsert = state.calls.find((c) => c[0] === 'upsert')
    expect(upsert?.[1]).toEqual({ run_key: 'apify:2026-06-21' })
    expect(upsert?.[2]).toMatchObject({ onConflict: 'run_key', ignoreDuplicates: true })
  })

  test('returns false on a conflict (no row returned → another invocation already claimed today)', async () => {
    state.result = { data: [], error: null }
    expect(await claimApifyRun('2026-06-21T03:00:00.000Z')).toBe(false)
  })

  test('FAILS CLOSED (false) on a DB error — never spend on an uncertain claim', async () => {
    state.result = { data: null, error: new Error('boom') }
    expect(await claimApifyRun('2026-06-21T03:00:00.000Z')).toBe(false)
  })

  test('fails closed (false) when the store is unconfigured', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    expect(await claimApifyRun('2026-06-21T03:00:00.000Z')).toBe(false)
  })
})

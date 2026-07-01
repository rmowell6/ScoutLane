import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Minimal chainable Supabase mock: terminal calls resolve to state.result (thenable for awaited
// builders, maybeSingle for the read).
const state = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        update: () => q,
        upsert: () => q,
        maybeSingle: async () => state.result,
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(state.result).then(onF, onR),
      }
      return q
    },
  }),
}))

import { getIngestState, saveIngestState, touchIngestState } from './ingestState'

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
}

beforeEach(() => {
  state.result = { data: null, error: null }
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
})

describe('ingestState (best-effort)', () => {
  test('unconfigured: read is null, writes are silent no-ops (degrade to a full fetch)', async () => {
    expect(await getIngestState('greenhouse:acme')).toBeNull()
    await expect(saveIngestState('greenhouse:acme', { etag: 'x', lastModified: null })).resolves.toBeUndefined()
    await expect(touchIngestState('greenhouse:acme')).resolves.toBeUndefined()
  })

  test('configured, row present: returns the stored validators', async () => {
    configure()
    state.result = { data: { etag: 'W/"abc"', last_modified: 'Wed, 01 Jul 2026 00:00:00 GMT' }, error: null }
    expect(await getIngestState('greenhouse:acme')).toEqual({
      etag: 'W/"abc"',
      lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT',
    })
  })

  test('configured, no row: returns null', async () => {
    configure()
    state.result = { data: null, error: null }
    expect(await getIngestState('greenhouse:acme')).toBeNull()
  })

  test('configured, DB error: read swallows and returns null; writes swallow and never throw', async () => {
    configure()
    state.result = { data: null, error: new Error('boom') }
    expect(await getIngestState('greenhouse:acme')).toBeNull()
    await expect(saveIngestState('greenhouse:acme', { etag: 'x', lastModified: null })).resolves.toBeUndefined()
    await expect(touchIngestState('greenhouse:acme')).resolves.toBeUndefined()
  })
})

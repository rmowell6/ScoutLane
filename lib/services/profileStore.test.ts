import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mutable mock state for the fake Supabase client (hoisted so the vi.mock factory can see it).
const state = vi.hoisted(() => ({
  insertResult: null as { data: unknown; error: unknown } | null,
  selectResult: null as { data: unknown; error: unknown } | null,
  lastInsert: null as unknown,
  eqArgs: [] as Array<[string, unknown]>,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        state.lastInsert = row
        return { select: () => ({ single: async () => state.insertResult }) }
      },
      // getStoredProfile now chains .eq('id').eq('user_id').maybeSingle() — chainable + records the
      // filters so a test can assert the owner scoping.
      select: () => {
        const chain = {
          eq: (col: string, val: unknown) => {
            state.eqArgs.push([col, val])
            return chain
          },
          maybeSingle: async () => state.selectResult,
        }
        return chain
      },
    }),
  }),
}))

import {
  ProfileStoreError,
  getStoredProfile,
  isProfileStoreConfigured,
  saveProfile,
} from './profileStore'

const PROFILE: Profile = {
  name: 'Ada Lovelace',
  summary: 'Engineer.',
  skills: ['Azure'],
  roles: [],
  certs: [],
  education: [],
}

describe('isProfileStoreConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SECRET_KEY
  })

  test('false when secrets are absent', () => {
    expect(isProfileStoreConfigured()).toBe(false)
  })

  test('true when both url and secret key are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
    expect(isProfileStoreConfigured()).toBe(true)
  })
})

describe('saveProfile / getProfile', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'
    state.insertResult = null
    state.selectResult = null
    state.lastInsert = null
    state.eqArgs = []
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SECRET_KEY
  })

  test('saveProfile persists structured + source + preferences and returns the new id', async () => {
    state.insertResult = { data: { id: 'row-123' }, error: null }
    const prefs = {
      targetCompTopUsd: 170000,
      targetLanes: ['Cloud Engineer'],
      workModes: [],
      employmentTypes: [],
      noGoLocations: [],
    }
    const { id } = await saveProfile(PROFILE, 'raw resume text', prefs, 'user-1')
    expect(id).toBe('row-123')
    expect(state.lastInsert).toEqual({ user_id: 'user-1', source_resume: 'raw resume text', structured: PROFILE, preferences: prefs })
  })

  test('saveProfile stores null preferences when none given', async () => {
    state.insertResult = { data: { id: 'row-1' }, error: null }
    await saveProfile(PROFILE, 'x', null, 'user-1')
    expect(state.lastInsert).toMatchObject({ preferences: null })
  })

  test('saveProfile tags a DB error with step "insert"', async () => {
    state.insertResult = { data: null, error: new Error('duplicate key') }
    await expect(saveProfile(PROFILE, 'x', null, 'user-1')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'insert',
    })
  })

  test('getStoredProfile returns a validated profile + parsed preferences', async () => {
    const prefs = { targetCompTopUsd: 170000, targetLanes: ['Cloud Engineer'], noGoLocations: [] }
    state.selectResult = { data: { structured: PROFILE, preferences: prefs }, error: null }
    const result = await getStoredProfile('row-123', 'user-1')
    expect(result?.profile).toEqual(PROFILE)
    expect(result?.preferences).toMatchObject({ targetCompTopUsd: 170000, targetLanes: ['Cloud Engineer'] })
  })

  test('getStoredProfile returns the original source resume text (for guardrail grounding)', async () => {
    state.selectResult = {
      data: { structured: PROFILE, preferences: null, source_resume: 'the original resume text' },
      error: null,
    }
    const result = await getStoredProfile('row-123', 'user-1')
    expect(result?.sourceResume).toBe('the original resume text')
  })

  test('getStoredProfile defaults sourceResume to empty string when the column is null', async () => {
    state.selectResult = { data: { structured: PROFILE, preferences: null, source_resume: null }, error: null }
    const result = await getStoredProfile('row-123', 'user-1')
    expect(result?.sourceResume).toBe('')
  })

  test('getStoredProfile tolerates absent preferences (null)', async () => {
    state.selectResult = { data: { structured: PROFILE, preferences: null }, error: null }
    const result = await getStoredProfile('row-123', 'user-1')
    expect(result?.profile).toEqual(PROFILE)
    expect(result?.preferences).toBeNull()
  })

  test('getStoredProfile returns null when no row matches', async () => {
    state.selectResult = { data: null, error: null }
    expect(await getStoredProfile('missing', 'user-1')).toBeNull()
  })

  test('getStoredProfile scopes the query to the owner (id AND user_id)', async () => {
    state.selectResult = { data: { structured: PROFILE, preferences: null }, error: null }
    await getStoredProfile('row-123', 'user-9')
    expect(state.eqArgs).toEqual(expect.arrayContaining([['id', 'row-123'], ['user_id', 'user-9']]))
  })

  test('getStoredProfile coerces legacy string[] certs to the object shape', async () => {
    const legacy = { ...PROFILE, certs: ['VCP-DCV', 'AWS SA Associate'] }
    state.selectResult = { data: { structured: legacy, preferences: null }, error: null }
    const result = await getStoredProfile('row-123', 'user-1')
    expect(result?.profile.certs).toEqual([{ name: 'VCP-DCV' }, { name: 'AWS SA Associate' }])
  })

  test('getStoredProfile rejects with step "validate" when stored shape is corrupt', async () => {
    state.selectResult = { data: { structured: { name: 123 }, preferences: null }, error: null }
    await expect(getStoredProfile('row-123', 'user-1')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'validate',
    })
  })

  test('throws a configure error when secrets are missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    await expect(saveProfile(PROFILE, 'x', null, 'user-1')).rejects.toBeInstanceOf(ProfileStoreError)
  })
})

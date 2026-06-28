import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mutable mock state for the fake Supabase client (hoisted so the vi.mock factory can see it).
const state = vi.hoisted(() => ({
  insertResult: null as { data: unknown; error: unknown } | null,
  selectResult: null as { data: unknown; error: unknown } | null,
  lastInsert: null as unknown,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        state.lastInsert = row
        return { select: () => ({ single: async () => state.insertResult }) }
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => state.selectResult }) }),
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
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SECRET_KEY
  })

  test('saveProfile persists structured + source + preferences and returns the new id', async () => {
    state.insertResult = { data: { id: 'row-123' }, error: null }
    const prefs = { targetCompTopUsd: 170000, targetLanes: ['Cloud Engineer'], noGoLocations: [] }
    const { id } = await saveProfile(PROFILE, 'raw resume text', prefs)
    expect(id).toBe('row-123')
    expect(state.lastInsert).toEqual({ source_resume: 'raw resume text', structured: PROFILE, preferences: prefs })
  })

  test('saveProfile stores null preferences when none given', async () => {
    state.insertResult = { data: { id: 'row-1' }, error: null }
    await saveProfile(PROFILE, 'x')
    expect(state.lastInsert).toMatchObject({ preferences: null })
  })

  test('saveProfile tags a DB error with step "insert"', async () => {
    state.insertResult = { data: null, error: new Error('duplicate key') }
    await expect(saveProfile(PROFILE, 'x')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'insert',
    })
  })

  test('getStoredProfile returns a validated profile + parsed preferences', async () => {
    const prefs = { targetCompTopUsd: 170000, targetLanes: ['Cloud Engineer'], noGoLocations: [] }
    state.selectResult = { data: { structured: PROFILE, preferences: prefs }, error: null }
    const result = await getStoredProfile('row-123')
    expect(result?.profile).toEqual(PROFILE)
    expect(result?.preferences).toMatchObject({ targetCompTopUsd: 170000, targetLanes: ['Cloud Engineer'] })
  })

  test('getStoredProfile returns the original source resume text (for guardrail grounding)', async () => {
    state.selectResult = {
      data: { structured: PROFILE, preferences: null, source_resume: 'the original resume text' },
      error: null,
    }
    const result = await getStoredProfile('row-123')
    expect(result?.sourceResume).toBe('the original resume text')
  })

  test('getStoredProfile defaults sourceResume to empty string when the column is null', async () => {
    state.selectResult = { data: { structured: PROFILE, preferences: null, source_resume: null }, error: null }
    const result = await getStoredProfile('row-123')
    expect(result?.sourceResume).toBe('')
  })

  test('getStoredProfile tolerates absent preferences (null)', async () => {
    state.selectResult = { data: { structured: PROFILE, preferences: null }, error: null }
    const result = await getStoredProfile('row-123')
    expect(result?.profile).toEqual(PROFILE)
    expect(result?.preferences).toBeNull()
  })

  test('getStoredProfile returns null when no row matches', async () => {
    state.selectResult = { data: null, error: null }
    expect(await getStoredProfile('missing')).toBeNull()
  })

  test('getStoredProfile rejects with step "validate" when stored shape is corrupt', async () => {
    state.selectResult = { data: { structured: { name: 123 }, preferences: null }, error: null }
    await expect(getStoredProfile('row-123')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'validate',
    })
  })

  test('throws a configure error when secrets are missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    await expect(saveProfile(PROFILE, 'x')).rejects.toBeInstanceOf(ProfileStoreError)
  })
})

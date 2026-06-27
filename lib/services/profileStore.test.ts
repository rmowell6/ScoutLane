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
  getProfile,
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

  test('saveProfile persists structured + source and returns the new id', async () => {
    state.insertResult = { data: { id: 'row-123' }, error: null }
    const { id } = await saveProfile(PROFILE, 'raw resume text')
    expect(id).toBe('row-123')
    expect(state.lastInsert).toEqual({ source_resume: 'raw resume text', structured: PROFILE })
  })

  test('saveProfile tags a DB error with step "insert"', async () => {
    state.insertResult = { data: null, error: new Error('duplicate key') }
    await expect(saveProfile(PROFILE, 'x')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'insert',
    })
  })

  test('getProfile returns a validated profile', async () => {
    state.selectResult = { data: { structured: PROFILE }, error: null }
    const result = await getProfile('row-123')
    expect(result).toEqual(PROFILE)
  })

  test('getProfile returns null when no row matches', async () => {
    state.selectResult = { data: null, error: null }
    expect(await getProfile('missing')).toBeNull()
  })

  test('getProfile rejects with step "validate" when stored shape is corrupt', async () => {
    state.selectResult = { data: { structured: { name: 123 } }, error: null }
    await expect(getProfile('row-123')).rejects.toMatchObject({
      name: 'ProfileStoreError',
      step: 'validate',
    })
  })

  test('throws a configure error when secrets are missing', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    await expect(saveProfile(PROFILE, 'x')).rejects.toBeInstanceOf(ProfileStoreError)
  })
})

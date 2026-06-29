import { afterEach, describe, expect, test, vi } from 'vitest'
import { NextResponse } from 'next/server'

// Drive getClaims() outcomes by swapping the server client the auth helpers build.
const getClaims = vi.hoisted(() => vi.fn())
const createSupabaseServerClient = vi.hoisted(() =>
  vi.fn(async () => ({ auth: { getClaims } })),
)
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient }))

import { getAuthUser, requireUser } from './auth'

afterEach(() => {
  getClaims.mockReset()
  createSupabaseServerClient.mockReset()
  createSupabaseServerClient.mockImplementation(async () => ({ auth: { getClaims } }))
})

describe('getAuthUser', () => {
  test('returns the user id + email from verified claims', async () => {
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'user-123', email: 'a@b.co' } }, error: null })
    expect(await getAuthUser()).toEqual({ id: 'user-123', email: 'a@b.co' })
  })

  test('null email when the claim is absent', async () => {
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'user-123' } }, error: null })
    expect(await getAuthUser()).toEqual({ id: 'user-123', email: null })
  })

  test('returns null when there are no claims (unauthenticated)', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: null })
    expect(await getAuthUser()).toBeNull()
  })

  test('returns null on a claims error', async () => {
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'x' } }, error: new Error('bad jwt') })
    expect(await getAuthUser()).toBeNull()
  })

  test('fails closed (null) when the client is unconfigured', async () => {
    createSupabaseServerClient.mockImplementationOnce(async () => {
      throw new Error('not configured')
    })
    expect(await getAuthUser()).toBeNull()
  })
})

describe('requireUser', () => {
  test('returns the AuthUser when authenticated', async () => {
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'user-123', email: 'a@b.co' } }, error: null })
    const result = await requireUser()
    expect(result).toEqual({ id: 'user-123', email: 'a@b.co' })
  })

  test('returns a 401 NextResponse when unauthenticated', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: null })
    const result = await requireUser()
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })
})

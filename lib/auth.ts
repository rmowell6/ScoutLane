// Auth boundary helpers (Engineering Plan §4.3). "Who is the caller" is derived from the verified
// JWT claims via getClaims(), NEVER getSession()/getUser(), which trust unverified cookie data on
// the server. Route handlers call requireUser() and return its NextResponse as-is when the caller is
// unauthenticated (same ergonomics as rateLimit()): `const user = await requireUser(); if (user
// instanceof NextResponse) return user`.
//
// Fails CLOSED: if Supabase auth is unconfigured or the claims can't be verified, the caller is
// treated as unauthenticated (401), never as an implicit admin. Access is fully gated.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export interface AuthUser {
  /** Supabase auth user id (JWT `sub`). The future per-user owner key (Phase B). */
  id: string
  email: string | null
}

/** Resolve the signed-in user from verified JWT claims, or null when unauthenticated/unconfigured. */
export async function getAuthUser(): Promise<AuthUser | null> {
  let supabase
  try {
    supabase = await createSupabaseServerClient()
  } catch {
    // Auth env not wired, fail closed (no implicit access).
    return null
  }
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims) return null
  const id = typeof claims.sub === 'string' ? claims.sub : null
  if (!id) return null
  const email = typeof claims.email === 'string' ? claims.email : null
  return { id, email }
}

/** Standard 401 body for a gated route. */
export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized', message: 'Sign in to continue.' },
    { status: 401 },
  )
}

/**
 * Gate a route on a signed-in user. Returns the AuthUser when authenticated, or a 401 NextResponse
 * the handler should return directly. (Phase B will use the returned id to stamp/scope user data.)
 */
export async function requireUser(): Promise<AuthUser | NextResponse> {
  const user = await getAuthUser()
  return user ?? unauthorized()
}

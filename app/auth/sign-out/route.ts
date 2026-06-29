// POST /auth/sign-out — clear the session and return to the sign-in page. POST (not GET) so a
// prefetch or an <img> can't silently log the user out (basic CSRF hygiene). signOut() clears the
// auth cookies via the SSR cookie adapter.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const { origin } = new URL(request.url)
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch (err) {
    // Even if sign-out errors (e.g. env unconfigured), send the user to /sign-in — failing toward
    // "signed out" is the safe direction.
    console.error('[auth] sign-out failed', err)
  }
  return NextResponse.redirect(new URL('/sign-in', origin), { status: 303 })
}

// GET /auth/callback — the OAuth / magic-link return target. Supabase redirects here with a PKCE
// `code` (Google sign-in and the email magic link both use the code flow); we exchange it for a
// session cookie, then redirect into the app. On any error we send the user back to /sign-in with a
// safe message rather than leaking provider error detail. Thin by design — no business logic.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Where a successful sign-in lands by default: the gated app home (the public landing is '/').
const POST_LOGIN_HOME = '/app'

/**
 * Resolve the post-login `next` target to a SAME-ORIGIN path, defeating open redirects. A naive
 * `startsWith('/')` check is bypassable: `/\evil.com` and `/%2F%2Fevil.com` both pass it yet the
 * browser (or a downstream `new URL`) can treat them as protocol-relative and navigate off-site.
 * Instead resolve `next` against our own origin and accept it ONLY if the resolved origin still
 * matches — then hand back just the path+query+hash so the caller can't be tricked into an absolute
 * URL. Anything cross-origin, malformed, or absolute collapses to the app home.
 */
export function safeNext(next: string | null, origin: string): string {
  if (!next) return POST_LOGIN_HOME
  try {
    const resolved = new URL(next, origin)
    if (resolved.origin !== origin) return POST_LOGIN_HOME
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return POST_LOGIN_HOME
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'), origin)

  // Provider-reported error (e.g. user denied access, or the allowlist trigger rejected sign-up).
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    const url = new URL('/sign-in', origin)
    url.searchParams.set('error', 'access_denied')
    return NextResponse.redirect(url)
  }

  if (!code) {
    const url = new URL('/sign-in', origin)
    url.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(url)
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth] exchangeCodeForSession failed', error.message)
      const url = new URL('/sign-in', origin)
      url.searchParams.set('error', 'exchange_failed')
      return NextResponse.redirect(url)
    }
  } catch (err) {
    console.error('[auth] callback failed', err)
    const url = new URL('/sign-in', origin)
    url.searchParams.set('error', 'callback_failed')
    return NextResponse.redirect(url)
  }

  return NextResponse.redirect(new URL(next, origin))
}

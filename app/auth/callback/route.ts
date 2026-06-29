// GET /auth/callback — the OAuth / magic-link return target. Supabase redirects here with a PKCE
// `code` (Google sign-in and the email magic link both use the code flow); we exchange it for a
// session cookie, then redirect into the app. On any error we send the user back to /sign-in with a
// safe message rather than leaking provider error detail. Thin by design — no business logic.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** Only allow same-origin relative redirects (no open-redirect via the `next` param). */
function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/'
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

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

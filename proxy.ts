// Next.js 16 middleware (conventionally named proxy.ts in v16).
// Refreshes the Supabase session using getClaims() — do NOT trust getSession()/getUser()
// in server code. See docs/ScoutLane_Engineering_Plan.md §4.3.
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Deploy resilience: before Supabase is wired (e.g. the very first Vercel deploy),
  // skip session refresh rather than crash every request. Once both env vars are set,
  // behavior is identical to the reference implementation.
  if (!url || !key) {
    return response
  }

  return refreshSession(request, response, url, key)
}

// Paths reachable WITHOUT a session. Everything else is gated (fully-gated access). API routes are
// excluded from the redirect gate on purpose: they self-authorize (requireUser → 401 JSON, or
// authorizeCron → bearer secret) so machine callers get a status code, not an HTML login redirect.
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' || // marketing landing (M4) — the public front door
    pathname === '/sign-in' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/')
  )
}

async function refreshSession(
  request: NextRequest,
  initialResponse: NextResponse,
  url: string,
  key: string,
) {
  let response = initialResponse

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Verifies the JWT locally and refreshes the session cookie.
  const { data } = await supabase.auth.getClaims()
  const isAuthed = Boolean(data?.claims?.sub)

  // Gate page navigations: an unauthenticated request to a protected page is redirected to sign-in
  // (with ?redirect so we can return them after login). API routes self-authorize, so skip them.
  const { pathname } = request.nextUrl
  if (!isAuthed && !isPublicPath(pathname)) {
    const signIn = request.nextUrl.clone()
    signIn.pathname = '/sign-in'
    signIn.search = ''
    signIn.searchParams.set('redirect', pathname)
    return NextResponse.redirect(signIn)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

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
  await supabase.auth.getClaims()

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

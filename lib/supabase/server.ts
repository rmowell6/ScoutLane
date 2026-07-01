// Server-side, request-scoped Supabase client (cookie-based session via @supabase/ssr). This is the
// ANON/PUBLISHABLE-key client that reads the signed-in user's session from cookies and RESPECTS RLS
//, distinct from lib/supabaseServer.ts, which uses the SECRET key and bypasses RLS for admin/storage
// work. Use this one for "who is the caller" (lib/auth.ts). cookies() is async in Next 16, await it.
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error('Supabase server client is not configured (set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)')
  }
  const cookieStore = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // setAll throws when called from a Server Component (cookies are read-only there). The
          // session is refreshed by proxy.ts on every request, so this is safe to ignore.
        }
      },
    },
  })
}

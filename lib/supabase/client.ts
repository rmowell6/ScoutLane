'use client'

// Browser-side Supabase client (cookie-based session via @supabase/ssr). Used only by client
// components (the sign-in page). Reads the PUBLISHABLE key, never the secret key, which is
// server-only and bypasses RLS. The SSR helpers keep the session in cookies so the server
// (proxy.ts + route handlers via lib/supabase/server.ts) can read the same session.
import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error('Supabase browser client is not configured (set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)')
  }
  return createBrowserClient(url, key)
}

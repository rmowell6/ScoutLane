// Shared server-side Supabase client (cloud-11). The store modules each built a NEW client on every
// call via createClient(); on a warm serverless instance that's wasteful. Construct once and reuse,
// rebuilding only if the env (url/key) actually changes — so a test that swaps env still gets a
// fresh client, while production (stable env) reuses one.
//
// Uses the SECRET key (server-only; bypasses RLS). Callers wrap the thrown "not configured" error in
// their own store-specific error type. Never import this into client/browser code.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: { key: string; client: SupabaseClient } | null = null

export function serverSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  // Env is checked BEFORE the cache, so removing the secret (e.g. in a test) reliably throws even
  // if a client was previously cached.
  if (!url || !key) throw new Error('Supabase server client is not configured')
  const cacheKey = `${url}::${key}`
  if (cached?.key === cacheKey) return cached.client
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  cached = { key: cacheKey, client }
  return client
}

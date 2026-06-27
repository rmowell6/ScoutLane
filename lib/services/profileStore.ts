// Profile persistence (M2): structure a resume once, store it, reuse it across jobs.
// Server-only — uses the Supabase SECRET key, which bypasses RLS, so persistence works
// pre-auth while the `profiles` table stays locked to the browser (migration 0001).
//
// Lazy + degradable like lib/storage.ts: the client is built on first use, so importing this
// module never throws when env is absent (keeps unit tests / builds working without secrets).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ProfileSchema, type Profile } from '@/lib/schemas'

const TABLE = 'profiles'

/** True when the server-side Supabase secrets are present. */
export function isProfileStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY // server-only; bypasses RLS
  if (!url || !key) throw new ProfileStoreError('configure', new Error('profile store is not configured'))
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** Carries which persistence step failed, so the route can report it without log-diving. */
export class ProfileStoreError extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(
      `profile store step '${step}' failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'ProfileStoreError'
  }
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[profiles] step ok: ${step} (${Date.now() - start}ms)`)
    return result
  } catch (err) {
    if (err instanceof ProfileStoreError) throw err // already tagged (e.g. configure)
    console.error(`[profiles] step failed: ${step} (${Date.now() - start}ms)`, err)
    throw new ProfileStoreError(step, err)
  }
}

/** Persist a structured profile + its source text. Returns the new row id. */
export async function saveProfile(profile: Profile, sourceResume: string): Promise<{ id: string }> {
  return runStep('insert', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .insert({ source_resume: sourceResume, structured: profile })
      .select('id')
      .single()
    if (error) throw error
    if (!data?.id) throw new Error('insert returned no id')
    return { id: data.id as string }
  })
}

/**
 * Load a stored profile by id. Returns null when no row matches. The stored `structured`
 * JSON is re-validated with the schema — never trust persisted shape blindly.
 */
export async function getProfile(id: string): Promise<Profile | null> {
  return runStep('select', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .select('structured')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const parsed = ProfileSchema.safeParse(data.structured)
    if (!parsed.success) throw new ProfileStoreError('validate', parsed.error)
    return parsed.data
  })
}

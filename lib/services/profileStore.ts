// Profile persistence (M2): structure a resume once, store it, reuse it across jobs.
// Server-only — uses the Supabase SECRET key, which bypasses RLS, so persistence works
// pre-auth while the `profiles` table stays locked to the browser (migration 0001).
//
// Lazy + degradable like lib/storage.ts: the client is built on first use, so importing this
// module never throws when env is absent (keeps unit tests / builds working without secrets).
import { type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabase } from '@/lib/supabaseServer'
import { CandidatePreferencesSchema, ProfileSchema, type CandidatePreferences, type Profile } from '@/lib/schemas'

const TABLE = 'profiles'

/** True when the server-side Supabase secrets are present. */
export function isProfileStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  try {
    return serverSupabase() // server-only; bypasses RLS; reused across calls
  } catch (err) {
    throw new ProfileStoreError('configure', err)
  }
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

export interface StoredProfile {
  profile: Profile
  /** Candidate preferences saved with the profile; null when none were provided. */
  preferences: CandidatePreferences | null
}

/** Persist a structured profile + its source text + optional preferences. Returns the new id. */
export async function saveProfile(
  profile: Profile,
  sourceResume: string,
  preferences?: CandidatePreferences | null,
): Promise<{ id: string }> {
  return runStep('insert', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .insert({ source_resume: sourceResume, structured: profile, preferences: preferences ?? null })
      .select('id')
      .single()
    if (error) throw error
    if (!data?.id) throw new Error('insert returned no id')
    return { id: data.id as string }
  })
}

/**
 * Load a stored profile (+ preferences) by id. Returns null when no row matches. Both stored
 * JSON blobs are re-validated with their schema — never trust persisted shape blindly.
 *
 * SECURITY (auth deferred): the `id` is a BEARER CAPABILITY — there is no ownership check, so anyone
 * holding the UUID can read this profile's PII. The route rate-limits to blunt enumeration. When
 * auth is wired, add a `user_id` predicate here (the column already exists on `profiles`).
 */
export async function getStoredProfile(id: string): Promise<StoredProfile | null> {
  return runStep('select', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .select('structured, preferences')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const parsed = ProfileSchema.safeParse(data.structured)
    if (!parsed.success) throw new ProfileStoreError('validate', parsed.error)

    let preferences: CandidatePreferences | null = null
    if (data.preferences != null) {
      const prefs = CandidatePreferencesSchema.safeParse(data.preferences)
      if (prefs.success) preferences = prefs.data // tolerate legacy/partial prefs: ignore if invalid
    }
    return { profile: parsed.data, preferences }
  })
}

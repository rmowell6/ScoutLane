// Profile persistence (M2): structure a resume once, store it, reuse it across jobs.
// Server-only, uses the Supabase SECRET key, which bypasses RLS, so persistence works
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
  /** The original uploaded resume text, ground truth for the no-fabrication guardrail (ai-26). */
  sourceResume: string
}

/** Persist a structured profile + its source text + optional preferences. Returns the new id. */
export async function saveProfile(
  profile: Profile,
  sourceResume: string,
  preferences: CandidatePreferences | null | undefined,
  userId: string,
): Promise<{ id: string }> {
  return runStep('insert', async () => {
    const { data, error } = await db()
      .from(TABLE)
      // Stamp the owner so reads can be scoped to them (Auth Phase B). The server uses the secret
      // key (bypasses RLS), so this column, not RLS alone, is what enforces ownership in code.
      .insert({ user_id: userId, source_resume: sourceResume, structured: profile, preferences: preferences ?? null })
      .select('id')
      .single()
    if (error) throw error
    if (!data?.id) throw new Error('insert returned no id')
    return { id: data.id as string }
  })
}

/**
 * Back-compat: profiles saved before certs carried status stored them as a bare string[]. Coerce
 * each legacy string cert to { name } (status absent == active) so the current ProfileSchema parses
 * them. New profiles already store the object shape and pass through untouched.
 */
function coerceLegacyCerts(structured: unknown): unknown {
  if (structured == null || typeof structured !== 'object') return structured
  const obj = structured as { certs?: unknown }
  if (!Array.isArray(obj.certs)) return structured
  return {
    ...obj,
    certs: obj.certs.map((c) => (typeof c === 'string' ? { name: c } : c)),
  }
}

/**
 * Load a stored profile (+ preferences) by id, SCOPED TO ITS OWNER (Auth Phase B). The query filters
 * on user_id, so a caller can only read their own profile even if they hold someone else's UUID, 
 * the id is no longer a bearer capability. A row owned by another user (or a legacy row with a null
 * user_id) returns null, identical to "not found" (we don't reveal existence). Stored JSON is
 * re-validated with its schema, never trust persisted shape blindly.
 */
export async function getStoredProfile(id: string, userId: string): Promise<StoredProfile | null> {
  return runStep('select', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .select('structured, preferences, source_resume')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const parsed = ProfileSchema.safeParse(coerceLegacyCerts(data.structured))
    if (!parsed.success) throw new ProfileStoreError('validate', parsed.error)

    let preferences: CandidatePreferences | null = null
    if (data.preferences != null) {
      const prefs = CandidatePreferencesSchema.safeParse(data.preferences)
      if (prefs.success) preferences = prefs.data // tolerate legacy/partial prefs: ignore if invalid
    }
    return { profile: parsed.data, preferences, sourceResume: (data.source_resume as string | null) ?? '' }
  })
}

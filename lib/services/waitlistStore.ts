// Waitlist persistence (M4). Server-only, uses the Supabase SECRET key (bypasses RLS), like
// profileStore/jobStore. Lazy + degradable so importing never throws without env (keeps CI unit
// tests + builds green when secrets are absent). The public landing's access-request form is the
// only writer, via the rate-limited /api/waitlist handler.
import { type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabase } from '@/lib/supabaseServer'

const TABLE = 'waitlist'

/** True when the server-side Supabase secrets are present. */
export function isWaitlistConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  try {
    return serverSupabase()
  } catch (err) {
    throw new WaitlistStoreError('configure', err)
  }
}

/** Carries which persistence step failed, so the route can report it without log-diving. */
export class WaitlistStoreError extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`waitlist store step '${step}' failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'WaitlistStoreError'
  }
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[waitlist] step ok: ${step} (${Date.now() - start}ms)`)
    return result
  } catch (err) {
    if (err instanceof WaitlistStoreError) throw err
    console.error(`[waitlist] step failed: ${step} (${Date.now() - start}ms)`, err)
    throw new WaitlistStoreError(step, err)
  }
}

export interface WaitlistEntry {
  email: string
  source?: string
  note?: string
}

/**
 * Add an email to the waitlist, idempotently. The email is normalized to lowercase so the
 * case-insensitive unique index treats `A@x.com` and `a@x.com` as one request; a repeat signup is a
 * silent no-op (no error, no duplicate), the handler returns the same generic success either way,
 * so the endpoint never reveals whether an address was already on the list (no enumeration).
 */
export async function addToWaitlist(entry: WaitlistEntry): Promise<void> {
  return runStep('insert', async () => {
    const row = {
      email: entry.email.trim().toLowerCase(),
      source: entry.source ?? null,
      note: entry.note ?? null,
    }
    // ignoreDuplicates: a conflict on the lower(email) index is expected and harmless, treat the
    // existing row as success rather than surfacing a 409.
    const { error } = await db().from(TABLE).upsert(row, { onConflict: 'email', ignoreDuplicates: true })
    if (error) throw error
  })
}

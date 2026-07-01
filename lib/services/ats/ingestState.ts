// Conditional-GET state for the ATS fetchers: the ETag / Last-Modified each per-company feed last
// returned, so the next cron run can send If-None-Match / If-Modified-Since and skip the full
// download+parse when a board answers 304 (migration 0018). Keyed by '<provider>:<token>'.
//
// Server-only (secret key, bypasses RLS), and STRICTLY best-effort: this is a cache, never a source
// of truth, so a read miss, a write failure, or an unconfigured store must degrade to a normal
// unconditional fetch, NEVER break ingest. Every function swallows its own errors and returns a safe
// default. Mirrors the degrade-quietly pattern of generationStore / apifyRunLock.
import { type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabase } from '@/lib/supabaseServer'

const TABLE = 'ingest_source_state'

/** The stored HTTP validators for one feed. */
export interface IngestSourceState {
  etag: string | null
  lastModified: string | null
}

/** True when the server-side Supabase secrets are present. */
function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  return serverSupabase() // server-only; bypasses RLS; reused across calls
}

/**
 * Read a feed's stored validators, or null when absent / unconfigured / on any error. A null return
 * simply means "fetch unconditionally this run". Never throws.
 */
export async function getIngestState(source: string): Promise<IngestSourceState | null> {
  if (!isConfigured()) return null
  try {
    const { data, error } = await db()
      .from(TABLE)
      .select('etag, last_modified')
      .eq('source', source)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return {
      etag: (data.etag as string | null) ?? null,
      lastModified: (data.last_modified as string | null) ?? null,
    }
  } catch (err) {
    console.warn(`[ingest] state read failed for ${source} (falling back to a full fetch)`, err)
    return null
  }
}

/**
 * Persist a feed's validators after a 200, for next run's conditional GET. Best-effort: on failure,
 * next run just refetches unconditionally (correct, only slower). Never throws.
 */
export async function saveIngestState(source: string, state: IngestSourceState): Promise<void> {
  if (!isConfigured()) return
  try {
    const { error } = await db()
      .from(TABLE)
      .upsert(
        { source, etag: state.etag, last_modified: state.lastModified, last_checked_at: new Date().toISOString() },
        { onConflict: 'source' },
      )
    if (error) throw error
  } catch (err) {
    console.warn(`[ingest] state write failed for ${source}`, err)
  }
}

/**
 * Record that a feed was checked and unchanged (304): bump last_checked_at only, leaving the stored
 * validators intact. Best-effort, never throws.
 */
export async function touchIngestState(source: string): Promise<void> {
  if (!isConfigured()) return
  try {
    const { error } = await db()
      .from(TABLE)
      .update({ last_checked_at: new Date().toISOString() })
      .eq('source', source)
    if (error) throw error
  } catch (err) {
    console.warn(`[ingest] state touch failed for ${source}`, err)
  }
}

// Job pool persistence (M3). Server-only — uses the Supabase SECRET key (bypasses RLS), like
// profileStore. Lazy + degradable so importing never throws without env. Ingestion upserts on
// (source, external_id) so re-running is idempotent (migration 0002).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as z from 'zod'
import type { IngestedJob } from '@/lib/services/ats/types'
import type { MatchableJob } from '@/lib/roleDiscovery/prefilter'

const TABLE = 'jobs'

// Search term is bounded before it reaches the .or() filter: a pathological multi-KB string
// would build a huge ILIKE pattern for no benefit.
const MAX_Q_LEN = 100

// Jobs come from external ATS feeds and are stored as-is, so a row read back is untrusted input.
// Re-validate the shape (and bound the JD body) at the read boundary before it flows into the
// packet pipeline — never assume the DB still holds what ingestion put there.
const JD_MAX_LEN = 60_000
const JobJdRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  jd_raw: z.string().max(JD_MAX_LEN).nullable().optional(),
})

export function isJobStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new JobStoreError('configure', new Error('job store is not configured'))
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export class JobStoreError extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`job store step '${step}' failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'JobStoreError'
  }
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[jobs] step ok: ${step} (${Date.now() - start}ms)`)
    return result
  } catch (err) {
    if (err instanceof JobStoreError) throw err
    console.error(`[jobs] step failed: ${step} (${Date.now() - start}ms)`, err)
    throw new JobStoreError(step, err)
  }
}

/** Light view for the picker list (no JD body). */
export interface StoredJob {
  id: string
  provider: string
  title: string
  company: string
  location: string | null
  url: string
}

function toRow(j: IngestedJob, now: string) {
  return {
    source: j.provider,
    external_id: j.externalId,
    title: j.title,
    company: j.company,
    location: j.location,
    url: j.url,
    jd_raw: j.jdText,
    status: 'live',
    validated_at: now,
  }
}

/** Upsert ingested jobs idempotently on (source, external_id). Returns the count written. */
export async function upsertJobs(jobs: IngestedJob[], now: string): Promise<number> {
  if (jobs.length === 0) return 0
  return runStep('upsert', async () => {
    const rows = jobs.map((j) => toRow(j, now))
    const { error, count } = await db()
      .from(TABLE)
      .upsert(rows, { onConflict: 'source,external_id', count: 'exact' })
    if (error) throw error
    return count ?? rows.length
  })
}

/**
 * Delete stale postings: rows whose `validated_at` predates `cutoffIso`. Every ingest run stamps
 * `validated_at = now` on each live posting it sees, so a row that hasn't been re-validated since the
 * cutoff is gone from every upstream feed and should leave the pool. The 14-day window (set by the
 * caller) is wide enough to ride out a transient provider outage without evicting still-live jobs.
 * Rows with a null `validated_at` (e.g. user-supplied targets) never match `<` and are preserved.
 * Returns the number of rows removed.
 */
export async function pruneStaleJobs(cutoffIso: string): Promise<number> {
  return runStep('prune', async () => {
    const { error, count } = await db()
      .from(TABLE)
      .delete({ count: 'exact' })
      .lt('validated_at', cutoffIso)
    if (error) throw error
    return count ?? 0
  })
}

export interface ListJobsOptions {
  /** Case-insensitive search over title + company. */
  q?: string
  limit?: number
}

/** List the pool for the picker, newest first. Optional case-insensitive title/company search. */
export async function listJobs(options: ListJobsOptions = {}): Promise<StoredJob[]> {
  const { q, limit = 50 } = options
  return runStep('list', async () => {
    let query = db()
      .from(TABLE)
      .select('id, source, title, company, location, url')
      .eq('status', 'live')

    const term = q?.trim().slice(0, MAX_Q_LEN)
    if (term) {
      // Neutralize every character with meaning inside a PostgREST .or() ILIKE filter: the
      // comma/parens that delimit and group filters, the % and _ LIKE wildcards, the * URL
      // wildcard, and the \ and " used for escaping/quoting. Replace with spaces so the term
      // matches literally and can't break out of the pattern.
      const safe = term.replace(/[%_*,()\\"]/g, ' ')
      query = query.or(`title.ilike.%${safe}%,company.ilike.%${safe}%`)
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string,
      provider: (r.source as string) ?? 'unknown',
      title: (r.title as string) ?? 'Untitled role',
      company: (r.company as string) ?? '',
      location: (r.location as string | null) ?? null,
      url: (r.url as string) ?? '',
    }))
  })
}

/**
 * Fetch the live pool for role discovery: light metadata plus a truncated JD snippet (enough to
 * carry each posting's skill vocabulary for the lexical pre-filter) — newest first. The snippet is
 * capped server-side so a huge JD can't bloat the candidate set.
 */
export async function listJobsForMatch(limit = 150, snippetChars = 600): Promise<MatchableJob[]> {
  return runStep('listForMatch', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .select('id, source, title, company, location, url, jd_raw')
      .eq('status', 'live')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id as string,
      provider: (r.source as string) ?? 'unknown',
      title: (r.title as string) ?? 'Untitled role',
      company: (r.company as string) ?? '',
      location: (r.location as string | null) ?? null,
      url: (r.url as string) ?? '',
      snippet: ((r.jd_raw as string | null) ?? '').slice(0, snippetChars),
    }))
  })
}

/** Full job incl. JD text, for feeding the packet pipeline by id. Null when not found. */
export async function getJobJd(id: string): Promise<{ id: string; title: string; company: string; jdText: string } | null> {
  return runStep('get', async () => {
    const { data, error } = await db()
      .from(TABLE)
      .select('id, title, company, jd_raw')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    // Re-validate the stored row before trusting it downstream.
    const row = JobJdRowSchema.parse(data)
    return {
      id: row.id,
      title: row.title ?? '',
      company: row.company ?? '',
      jdText: row.jd_raw ?? '',
    }
  })
}

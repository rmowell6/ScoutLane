// Job pool persistence (M3). Server-only — uses the Supabase SECRET key (bypasses RLS), like
// profileStore. Lazy + degradable so importing never throws without env. Ingestion upserts on
// (source, external_id) so re-running is idempotent (migration 0002).
import { type SupabaseClient } from '@supabase/supabase-js'
import * as z from 'zod'
import { serverSupabase } from '@/lib/supabaseServer'
import type { IngestedJob } from '@/lib/services/ats/types'
import type { MatchableJob } from '@/lib/roleDiscovery/prefilter'
import { isUsRole } from '@/lib/roleDiscovery/usLocation'

const TABLE = 'jobs'

// Search term is bounded before it reaches the .or() filter: a pathological multi-KB string
// would build a huge ILIKE pattern for no benefit.
const MAX_Q_LEN = 100

// Jobs come from external ATS feeds and are stored as-is, so a row read back is untrusted input.
// Re-validate the shape (and bound the JD body) at the read boundary before it flows into the
// packet pipeline — never assume the DB still holds what ingestion put there.
const JD_MAX_LEN = 60_000
// Truncate (don't reject) an oversized stored JD on read: capping with .max() would THROW, which
// would brick an otherwise-valid job whose description was written before the write-side cap existed
// (the ATS write path was previously unbounded). Degrade gracefully instead.
const JobJdRowSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  jd_raw: z
    .string()
    .nullable()
    .optional()
    .transform((s) => (s ?? '').slice(0, JD_MAX_LEN)),
})

// Light picker-row shape, validated at the read boundary (same "DB rows are untrusted" rule as
// JobJdRowSchema). Missing/blank columns coerce to safe display defaults rather than leaking `null`
// or an unchecked cast into the UI; a row that can't be coerced is dropped by the caller, not thrown.
const JobListRowSchema = z.object({
  id: z.string(),
  source: z.string().nullable().optional().transform((s) => s ?? 'unknown'),
  title: z.string().nullable().optional().transform((s) => s ?? 'Untitled role'),
  company: z.string().nullable().optional().transform((s) => s ?? ''),
  location: z.string().nullable().optional().transform((s) => s ?? null),
  url: z.string().nullable().optional().transform((s) => s ?? ''),
})

function toStoredJob(row: z.infer<typeof JobListRowSchema>): StoredJob {
  return { id: row.id, provider: row.source, title: row.title, company: row.company, location: row.location, url: row.url }
}

export function isJobStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  try {
    return serverSupabase()
  } catch (err) {
    throw new JobStoreError('configure', err)
  }
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
    // Bound on write like jobBoardStore does — an oversized ATS description must not produce a row
    // that the read-side cap would otherwise have to reject.
    jd_raw: (j.jdText ?? '').slice(0, JD_MAX_LEN),
    status: 'live',
    validated_at: now,
  }
}

/** Upsert ingested jobs idempotently on (source, external_id). Returns the count written. */
export async function upsertJobs(jobs: IngestedJob[], now: string): Promise<number> {
  if (jobs.length === 0) return 0
  // US-market only: never STORE a clearly-non-US posting. This is the defense-in-depth chokepoint
  // every ingest path passes through (the unified cron AND the ATS-only route), so non-US roles
  // never enter the pool for any consumer. Bias toward keeping (isUsLocation): Remote / unknown /
  // unrecognized locations stay; only a clearly-non-US place with no US signal is dropped.
  const usJobs = jobs.filter((j) => isUsRole({ location: j.location, company: j.company, title: j.title }))
  if (usJobs.length === 0) return 0
  return runStep('upsert', async () => {
    const rows = usJobs.map((j) => toRow(j, now))
    const { error, count } = await db()
      .from(TABLE)
      .upsert(rows, { onConflict: 'source,external_id', count: 'exact' })
    if (error) throw error
    return count ?? rows.length
  })
}

/**
 * Soft-expire stale postings — REVERSIBLY — but ONLY for sources confirmed live this run. A row is
 * flipped 'live' -> 'expired' iff (a) its `source` is in `sources` (a source ScoutLane actually
 * re-observed successfully this run), (b) it is still 'live', and (c) its `validated_at` predates
 * `cutoffIso`. Because every successful upsert re-stamps `validated_at = now` AND `status = 'live'`,
 * a posting that reappears later automatically un-expires. This is the safe replacement for an
 * unconditional DELETE: a provider/leg that failed this run is NOT in `sources`, so its still-live
 * rows can never be aged out by a run that never actually saw that source (no silent data loss).
 * Rows with a null `validated_at` (e.g. user-supplied targets) never match `<` and are preserved.
 * Returns the number of rows expired.
 */
export async function expireStaleJobs(sources: string[], cutoffIso: string): Promise<number> {
  if (sources.length === 0) return 0
  return runStep('expire', async () => {
    const { error, count } = await db()
      .from(TABLE)
      .update({ status: 'expired' }, { count: 'exact' })
      .eq('status', 'live')
      .in('source', sources)
      .lt('validated_at', cutoffIso)
    if (error) throw error
    return count ?? 0
  })
}

/**
 * Physically reclaim rows that have been soft-expired and NOT re-seen since the (longer) `cutoffIso`.
 * Safe to run unconditionally and across all sources: a posting that reappeared was already flipped
 * back to 'live' by its upsert, so only genuinely-gone postings remain 'expired' past the window.
 * This is the second, well-separated stage — a wrongly-expired row has the full reclaim window to
 * come back before any irreversible delete. Returns the number of rows deleted.
 */
export async function reclaimExpiredJobs(cutoffIso: string): Promise<number> {
  return runStep('reclaim', async () => {
    const { error, count } = await db()
      .from(TABLE)
      .delete({ count: 'exact' })
      .eq('status', 'expired')
      .lt('validated_at', cutoffIso)
    if (error) throw error
    return count ?? 0
  })
}

export interface ListJobsOptions {
  /** Case-insensitive search over title + company. */
  q?: string
  limit?: number
  /**
   * Drop clearly-non-US postings (the product assumes US work authorization). Default true, matching
   * discoverRoles — the seed boards hire globally (e.g. Arbeitnow is German), so without this the
   * picker surfaces EU roles at the top by recency. Set false to include international postings.
   */
  usOnly?: boolean
}

/** List the pool for the picker, newest first. Optional case-insensitive title/company search. */
export async function listJobs(options: ListJobsOptions = {}): Promise<StoredJob[]> {
  const { q, limit = 50, usOnly = true } = options
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

    // Location is free text, so the US filter runs in app code (not SQL). Over-fetch when filtering
    // so a pool top-heavy with non-US rows still yields up to `limit` US postings.
    const fetchLimit = usOnly ? Math.min(limit * 4, 400) : limit
    const { data, error } = await query.order('created_at', { ascending: false }).limit(fetchLimit)
    if (error) throw error
    // Validate each row; skip (don't throw on) a malformed one so one bad row can't brick the picker.
    const out: StoredJob[] = []
    for (const r of data ?? []) {
      const parsed = JobListRowSchema.safeParse(r)
      if (!parsed.success) continue
      const job = toStoredJob(parsed.data)
      if (usOnly && !isUsRole({ location: job.location, company: job.company, title: job.title })) continue
      out.push(job)
      if (out.length >= limit) break
    }
    return out
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

/**
 * Pool freshness for the readiness check (/health): how many live jobs, and when the pool was last
 * refreshed (max validated_at). A stale/empty pool means the ingest cron has silently stopped — this
 * makes that observable from outside. Best-effort: the caller treats a throw as "stats unavailable".
 */
export async function getPoolStats(): Promise<{ live: number; lastIngestAt: string | null }> {
  return runStep('stats', async () => {
    const client = db()
    const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([
      client.from(TABLE).select('id', { count: 'exact', head: true }).eq('status', 'live'),
      client
        .from(TABLE)
        .select('validated_at')
        .eq('status', 'live')
        .order('validated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (countErr) throw countErr
    if (dataErr) throw dataErr
    return {
      live: count ?? 0,
      lastIngestAt: (data?.validated_at as string | null) ?? null,
    }
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

// ── Style-signal cache (jobs.style_signals) ──────────────────────────────────────────────────────
// A pooled job's domain/seniority/role-type classification is a pure function of its static JD, so
// it's classified once (by recommendStyle) and cached on the row. This is the container-friendly,
// DB-backed cache: every instance shares it, and a repeat packet against the same job skips the LLM
// call entirely. The shape is validated by the caller (recommendStyle) — stored as opaque jsonb here.

/** Read a job's cached style classification, or null if absent. */
export async function getJobStyleSignals(id: string): Promise<Record<string, unknown> | null> {
  return runStep('styleSignals:get', async () => {
    const { data, error } = await db().from(TABLE).select('style_signals').eq('id', id).maybeSingle()
    if (error) throw error
    const sig = data?.style_signals
    return sig != null && typeof sig === 'object' ? (sig as Record<string, unknown>) : null
  })
}

/** Persist a job's style classification for reuse (best-effort cache write). */
export async function saveJobStyleSignals(id: string, signals: Record<string, unknown>): Promise<void> {
  return runStep('styleSignals:save', async () => {
    const { error } = await db().from(TABLE).update({ style_signals: signals }).eq('id', id)
    if (error) throw error
  })
}

// Job pool persistence (M3). Server-only — uses the Supabase SECRET key (bypasses RLS), like
// profileStore. Lazy + degradable so importing never throws without env. Ingestion upserts on
// (source, external_id) so re-running is idempotent (migration 0002).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IngestedJob } from '@/lib/services/ats/types'

const TABLE = 'jobs'

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

    const term = q?.trim()
    if (term) {
      // Escape PostgREST/ILIKE wildcards and the comma that delimits .or() filters.
      const safe = term.replace(/[%,()]/g, ' ')
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
    return {
      id: data.id as string,
      title: (data.title as string) ?? '',
      company: (data.company as string) ?? '',
      jdText: (data.jd_raw as string) ?? '',
    }
  })
}

// Job-board persistence — writes normalized job-board `Job`s into the same `jobs` table as the
// ATS ingest, using the same hardened, lazy/degradable Supabase pattern as jobStore.ts (which is
// left untouched per the integration handoff). The ATS module owns `IngestedJob`; the job-board
// module has its own `Job` shape, so this is the bridge: map `Job` -> the shared row shape and
// upsert idempotently on (source, external_id).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { JobStoreError } from './jobStore'
import type { Job } from '@/src/jobBoards/types'

const TABLE = 'jobs'
// Bound the JD body we store, matching jobStore's read-side cap, so a giant scraped description
// can't bloat a row.
const JD_MAX_LEN = 60_000

export function isJobBoardStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new JobStoreError('configure', new Error('job store is not configured'))
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export interface JobBoardRow {
  source: string
  external_id: string
  title: string
  company: string
  location: string | null
  url: string
  jd_raw: string
  status: 'live'
  validated_at: string
}

/**
 * Map a normalized job-board `Job` to a `jobs` row. `Job.id` is "<source>:<externalId>", but the
 * external id can itself contain ':' (URLs, composite ids), so take everything AFTER the first
 * colon rather than a naive split — and fall back to the whole id if there's no colon.
 */
export function toJobBoardRow(job: Job, now: string): JobBoardRow {
  const sep = job.id.indexOf(':')
  const externalId = sep >= 0 ? job.id.slice(sep + 1) : job.id
  return {
    source: job.source,
    external_id: externalId || job.id,
    title: job.title,
    company: job.company,
    location: job.location?.trim() ? job.location.trim() : null,
    url: job.url,
    jd_raw: (job.description ?? '').slice(0, JD_MAX_LEN),
    status: 'live',
    validated_at: now,
  }
}

/**
 * De-dupe rows by (source, external_id). A single Postgres upsert cannot touch the same conflict
 * target twice in one statement ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
 * and the aggregator can surface the same posting from two passes — so collapse before writing.
 */
export function dedupeRows(rows: JobBoardRow[]): JobBoardRow[] {
  const byKey = new Map<string, JobBoardRow>()
  for (const row of rows) byKey.set(`${row.source}::${row.external_id}`, row)
  return [...byKey.values()]
}

/**
 * CONTRACT GUARD (vendored shape drift). The vendored module's `Job` shape is mapped to a row above;
 * this is the single chokepoint that protects the pool when a provider's payload drifts from what its
 * mapper expects (as the Himalayas browse feed once did, emitting url-less jobs). A job is storable
 * only if it has the fields the pool/discovery actually need — url, title, source. Anything else is
 * dropped here instead of polluting the pool. If a new provider is added or a feed changes shape,
 * this is the invariant to keep green.
 */
export function isStorableJob(job: Job): boolean {
  return Boolean(job && job.url?.trim() && job.title?.trim() && job.source?.trim())
}

/** Upsert job-board jobs idempotently on (source, external_id). Returns the count written. */
export async function upsertJobBoardJobs(jobs: Job[], now: string): Promise<number> {
  const valid = jobs.filter(isStorableJob)
  if (valid.length === 0) return 0
  const start = Date.now()
  try {
    const rows = dedupeRows(valid.map((j) => toJobBoardRow(j, now)))
    const { error, count } = await db()
      .from(TABLE)
      .upsert(rows, { onConflict: 'source,external_id', count: 'exact' })
    if (error) throw error
    console.log(`[boards] step ok: upsert (${Date.now() - start}ms, ${rows.length} rows)`)
    return count ?? rows.length
  } catch (err) {
    if (err instanceof JobStoreError) throw err
    console.error(`[boards] step failed: upsert (${Date.now() - start}ms)`, err)
    throw new JobStoreError('upsert', err)
  }
}

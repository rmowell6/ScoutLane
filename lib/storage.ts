// Supabase Storage helper for generated documents (Engineering Plan §4.7).
// Lazy by design: the client is constructed on first use, so importing this module never throws
// when env is absent (keeps unit tests / builds that import the pipeline working without secrets).
import { serverSupabase } from '@/lib/supabaseServer'

const BUCKET = 'documents'
const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** True when the server-side Supabase secrets are present. */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function storageClient() {
  return serverSupabase() // server-only; bypasses RLS; reused across calls
}

/**
 * Upload a .docx buffer and return a time-limited signed URL.
 * @param prefix a folder/name prefix, e.g. 'resumes' or 'cover-letters'
 * @param id a unique id (caller supplies; crypto.randomUUID() upstream)
 * @param downloadName the filename the browser should save as
 */
export async function uploadDocx(
  buffer: Buffer,
  prefix: string,
  id: string,
  downloadName: string,
  expiresInSeconds = 60 * 60,
): Promise<{ path: string; signedUrl: string }> {
  const supabase = storageClient()
  const path = `${prefix}/${id}.docx`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: DOCX_CONTENT_TYPE, upsert: false })
  if (uploadError) throw uploadError

  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds, { download: downloadName })
  if (signError) throw signError

  return { path, signedUrl: data.signedUrl }
}

// Prefixes (folders) under the documents bucket that packet generation writes to. Cleanup sweeps
// each one. Keep in sync with the uploadDocx() callers in lib/services/buildPacket.ts.
const PACKET_PREFIXES = ['resumes', 'cover-letters', 'fit-assessments'] as const

// Supabase Storage list() caps page size at 100 by default; page through so a backlog of files
// is fully swept rather than truncated to the first page.
const LIST_PAGE_SIZE = 100
// Supabase Storage remove() accepts a bounded list of paths per call; chunk so a large backlog
// doesn't exceed the limit.
const REMOVE_CHUNK = 1000

/** A Storage object as returned by list() — enough of the shape to decide expiry. */
export interface StorageEntry {
  name: string
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Pure: names of entries older than `cutoffMs`. `created_at` is the upload time; fall back to
 * `updated_at` if a backend omits it. An entry with NEITHER timestamp is left alone (never
 * guessed-stale) rather than deleted. Exported for unit testing the expiry decision in isolation.
 */
export function expiredEntryNames(entries: StorageEntry[], cutoffMs: number): string[] {
  return entries
    .filter((f) => {
      const ts = f.created_at ?? f.updated_at
      return ts ? new Date(ts).getTime() < cutoffMs : false
    })
    .map((f) => f.name)
}

/**
 * Delete generated packet files older than `olderThanMs` from the documents bucket. Packets are
 * one-shot downloads — their signed URLs expire in an hour — so anything past a day is abandoned and
 * only consuming storage. Idempotent and best-effort: a sweep that finds nothing deletes nothing.
 * Returns the number of files removed. Caller decides the schedule (wired into the daily cron).
 *
 * Pages with offset-based listing but does NOT delete mid-listing: deleting while paging by offset
 * shifts later items past the read window and silently skips files. So we collect every expired path
 * for a prefix FIRST (stable offset paging, no mutation), then delete once.
 */
export async function cleanupOldDocs(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const supabase = storageClient()
  const cutoff = Date.now() - olderThanMs
  let removed = 0

  for (const prefix of PACKET_PREFIXES) {
    // Phase 1 — collect all expired paths (no deletes, so offset paging stays stable).
    const paths: string[] = []
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset })
      if (error) throw error
      const page = data ?? []
      if (page.length === 0) break
      paths.push(...expiredEntryNames(page, cutoff).map((name) => `${prefix}/${name}`))
      if (page.length < LIST_PAGE_SIZE) break
    }

    // Phase 2 — delete the collected paths in bounded chunks.
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK)
      const { error: rmError } = await supabase.storage.from(BUCKET).remove(chunk)
      if (rmError) throw rmError
      removed += chunk.length
    }
  }

  return removed
}

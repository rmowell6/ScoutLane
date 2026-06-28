// Supabase Storage helper for generated documents (Engineering Plan §4.7).
// Lazy by design: the client is constructed on first use, so importing this module never throws
// when env is absent (keeps unit tests / builds that import the pipeline working without secrets).
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'documents'
const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** True when the server-side Supabase secrets are present. */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

function storageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY // server-only; bypasses RLS
  if (!url || !key) throw new Error('Supabase storage is not configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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

/**
 * Delete generated packet files older than `olderThanMs` from the documents bucket. Packets are
 * one-shot downloads — their signed URLs expire in an hour — so anything past a day is abandoned and
 * only consuming storage. Idempotent and best-effort: a sweep that finds nothing deletes nothing.
 * Returns the number of files removed. Caller decides the schedule (wired into the daily cron).
 */
export async function cleanupOldDocs(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const supabase = storageClient()
  const cutoff = Date.now() - olderThanMs
  let removed = 0

  for (const prefix of PACKET_PREFIXES) {
    // Page through the prefix; each page lists up to LIST_PAGE_SIZE objects.
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset })
      if (error) throw error
      const page = data ?? []
      if (page.length === 0) break

      // created_at is the upload time; fall back to updated_at if a backend omits it. A file with
      // neither timestamp is left alone rather than guessed-stale.
      const expired = page.filter((f) => {
        const ts = f.created_at ?? f.updated_at
        return ts ? new Date(ts).getTime() < cutoff : false
      })
      if (expired.length > 0) {
        const paths = expired.map((f) => `${prefix}/${f.name}`)
        const { error: rmError } = await supabase.storage.from(BUCKET).remove(paths)
        if (rmError) throw rmError
        removed += paths.length
      }

      if (page.length < LIST_PAGE_SIZE) break
    }
  }

  return removed
}

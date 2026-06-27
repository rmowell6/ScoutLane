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

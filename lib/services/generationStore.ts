// Generation persistence (M2 / observability): record each SHIPPED packet so there is a durable
// history of what was generated, for whom, against which job, and how the guardrails ruled. The
// generations table + its owner-only RLS have existed since migrations 0001/0007/0009/0015 with no
// writer, this is that writer.
//
// Best-effort by design: a failed insert must NEVER break packet delivery (the packet already
// succeeded when this runs), so the caller invokes this inside a try/catch and this module returns
// null when the store is not configured. Server-only, uses the Supabase SECRET key (bypasses RLS),
// so it works pre-auth while the table stays locked to the browser; ownership is enforced in code by
// stamping user_id, exactly like profileStore.
import { type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabase } from '@/lib/supabaseServer'
import type { Packet } from '@/lib/services/buildPacket'

const TABLE = 'generations'

/** True when the server-side Supabase secrets are present. */
export function isGenerationStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

export interface SaveGenerationInput {
  userId: string
  /** The stored profile this packet reused, null on the stateless (pasted-resume) path. */
  profileId?: string | null
  /** The pooled job this packet targeted, null on the stateless (pasted-JD) path. */
  jobId?: string | null
  packet: Packet
}

/**
 * Persist a record of a shipped packet. Returns the new id, or null when the store is unconfigured
 * (degrade quietly). Throws only on a genuine insert error so the caller can log it; the caller must
 * treat that as non-blocking. Stores the fit scores, the keyword-coverage inputs, the guardrail
 * report, the applied style, and the document filenames (a human-meaningful reference; the durable
 * Storage keys are not threaded through the Packet today).
 */
export async function saveGeneration(input: SaveGenerationInput): Promise<{ id: string } | null> {
  if (!isGenerationStoreConfigured()) return null
  const { userId, profileId, jobId, packet } = input
  const start = Date.now()

  const db: SupabaseClient = serverSupabase()
  const { data, error } = await db
    .from(TABLE)
    .insert({
      // Stamp the owner in code (the secret key bypasses RLS), mirroring saveProfile.
      user_id: userId,
      profile_id: profileId ?? null,
      job_id: jobId ?? null,
      scores: packet.fit,
      keyword_coverage: {
        mustHave: packet.fitInput.mustHaveSkills,
        preferred: packet.fitInput.preferredSkills ?? [],
        candidate: packet.fitInput.candidateSkills,
        adjacent: packet.fitInput.adjacentSkills ?? [],
      },
      guardrail_report: packet.guardrails,
      style: packet.style,
      resume_doc_path: packet.documents?.resume.docx.filename ?? null,
      cover_doc_path: packet.documents?.coverLetter.docx.filename ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  if (!data?.id) throw new Error('generation insert returned no id')
  console.log(`[generations] step ok: insert (${Date.now() - start}ms)`)
  return { id: data.id as string }
}

// Per-day idempotency claim for the METERED Apify leg (Engineering Plan §4.1, locking policy out of
// the route, like apifySchedule.ts). Vercel cron is best-effort and may double-fire, and a near-120s
// timeout can re-enter the handler, so without a guard the $0.99/run-flat Wellfound actor could be
// charged twice on an Apify day, overrunning the $5 credit (which has < $1 headroom at 3 runs/mo).
//
// DB-row upsert on (source, external_id) dedups rows WRITTEN, never runs CHARGED, so it cannot
// prevent a second spend. The correct primitive is an atomically-claimed marker keyed to the unit of
// work (the UTC day), claimed BEFORE the actor fires. We use INSERT ... ON CONFLICT DO NOTHING via
// supabase-js upsert(ignoreDuplicates) + .select(): exactly one caller per day gets a row back.
//
// NOTE: a session-level pg_advisory_lock would be WRONG here, supabase-js runs over the
// transaction-mode pooler, where the lock evaporates between statements. A durable marker row also
// survives across separate invocations within the day (a lock only covers concurrent overlap).
import { type SupabaseClient } from '@supabase/supabase-js'
import { serverSupabase } from '@/lib/supabaseServer'

const TABLE = 'ingest_run_markers'

function db(): SupabaseClient {
  return serverSupabase() // server-only; bypasses RLS; reused across calls
}

/** UTC-day run key, e.g. 'apify:2026-06-21'. UTC matches isApifyDay's getUTCDate(). */
export function apifyRunKey(nowIso: string): string {
  return `apify:${nowIso.slice(0, 10)}`
}

/**
 * Atomically claim the Apify run for the given UTC day. Returns true for EXACTLY ONE caller per day;
 * a duplicate cron fire or post-timeout re-entry gets false and must not run the metered actors.
 *
 * Fails CLOSED (returns false) on any error: skipping a metered run costs $0, but an erroneous extra
 * run costs real money, so when in doubt, don't spend.
 */
export async function claimApifyRun(nowIso: string): Promise<boolean> {
  const runKey = apifyRunKey(nowIso)
  const start = Date.now()
  try {
    // ON CONFLICT DO NOTHING + RETURNING: a fresh claim returns the row; a conflict returns nothing.
    const { data, error } = await db()
      .from(TABLE)
      .upsert({ run_key: runKey }, { onConflict: 'run_key', ignoreDuplicates: true })
      .select('run_key')
    if (error) throw error
    const claimed = (data?.length ?? 0) === 1
    console.log(`[boards] step ok: claim-apify-run ${runKey} -> ${claimed} (${Date.now() - start}ms)`)
    return claimed
  } catch (err) {
    console.error(`[boards] step failed: claim-apify-run ${runKey} (${Date.now() - start}ms)`, err)
    return false
  }
}

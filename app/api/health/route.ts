import { NextResponse } from 'next/server'
import { getPoolStats, isJobStoreConfigured } from '@/lib/services/jobStore'

// GET handlers are dynamic (uncached) by default in Next 16. nodejs runtime: pool stats hit Supabase.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Readiness, not just liveness: report pool freshness so a silently-stopped ingest cron is
// observable from outside (a monitor can alert on stale `lastIngestAt` or live=0). Best-effort, a
// stats failure must never make /health itself fail.
export async function GET() {
  let pool: { live: number; lastIngestAt: string | null } | null = null
  if (isJobStoreConfigured()) {
    try {
      pool = await getPoolStats()
    } catch {
      pool = null
    }
  }
  return NextResponse.json({ ok: true, pool })
}

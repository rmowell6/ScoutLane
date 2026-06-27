// POST /api/jobs/ingest — fetch the seed pool from public ATS APIs and upsert it (M3).
// Idempotent (upsert on source+external_id), so it's safe to re-run and safe for a future cron.
// Optional auth: if CRON_SECRET is set, require `Authorization: Bearer <secret>` — this writes to
// the DB and calls out to external APIs, so gate it once a secret exists; open otherwise for POC.
import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/services/ats'
import { JobStoreError, isJobStoreConfigured, upsertJobs } from '@/lib/services/jobStore'

export const runtime = 'nodejs'
export const maxDuration = 120

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured -> open (POC)
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }

    const results = await ingestAll()
    const allJobs = results.flatMap((r) => r.jobs)
    const now = new Date().toISOString()
    const upserted = await upsertJobs(allJobs, now)

    // Per-source report: exactly which boards succeeded/failed and how many roles each yielded.
    const sources = results.map((r) => ({
      provider: r.source.provider,
      token: r.source.token,
      company: r.source.company,
      ok: r.ok,
      count: r.jobs.length,
      ...(r.error ? { error: r.error } : {}),
    }))
    const okCount = results.filter((r) => r.ok).length

    console.log(`[jobs] ingest done: ${okCount}/${results.length} sources ok, ${upserted} upserted`)
    return NextResponse.json(
      { upserted, sourcesOk: okCount, sourcesTotal: results.length, sources },
      { status: 200 },
    )
  } catch (err) {
    const step = err instanceof JobStoreError ? err.step : null
    const message = err instanceof Error ? err.message : String(err)
    console.error('[jobs] ingest failed', step ?? '', err)
    return NextResponse.json({ error: 'Internal Server Error', step, message }, { status: 500 })
  }
}

// POST /api/jobs/ingest, fetch the seed pool from public ATS APIs and upsert it (M3).
// Idempotent (upsert on source+external_id), so it's safe to re-run and safe for a future cron.
// Auth: require `Authorization: Bearer <CRON_SECRET>`. This writes to the DB and calls out to
// external APIs, so it must not be openly callable in production. Fail CLOSED in prod, if no
// secret is configured, the endpoint is unavailable (503) rather than wide open. Outside prod
// (local/preview POC) it stays open when no secret is set, for convenience.
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/services/ats'
import { JobStoreError, isJobStoreConfigured, upsertJobs } from '@/lib/services/jobStore'
import { serverErrorBody } from '@/lib/http/errors'

export const runtime = 'nodejs'
export const maxDuration = 120

const isProd = process.env.NODE_ENV === 'production'

/** Constant-time compare so a wrong token can't be recovered by timing the response. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

type AuthResult = 'ok' | 'unauthorized' | 'misconfigured'

function authorize(request: Request): AuthResult {
  const secret = process.env.CRON_SECRET
  if (!secret) return isProd ? 'misconfigured' : 'ok' // fail closed in prod; open for local POC
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`) ? 'ok' : 'unauthorized'
}

// Exported for both GET (so this manual route is also cron-/browser-triggerable, like ingest-all, 
// Vercel Cron sends GET) and POST (existing curl callers). authorize() reads the header either way.
async function handleIngest(request: Request) {
  try {
    const auth = authorize(request)
    if (auth === 'unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (auth === 'misconfigured') {
      console.error('[jobs] ingest refused: CRON_SECRET is not set in production')
      return NextResponse.json(
        { error: 'Ingest endpoint not configured', message: 'CRON_SECRET is required in production' },
        { status: 503 },
      )
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
    console.error('[jobs] ingest failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

export const GET = handleIngest
export const POST = handleIngest

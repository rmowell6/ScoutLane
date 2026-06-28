// POST /api/jobs/ingest-all — the UNIFIED cron ingest. Refreshes the whole `jobs` pool in one
// run: the ATS boards (Greenhouse/Lever/Ashby) AND the job-board aggregator (Himalayas, Arbeitnow,
// Remotive, RemoteOK + keyed: JSearch, Adzuna, USAJobs, Apify). A single daily Vercel cron points
// here (vercel.json). The existing /api/jobs/ingest stays for manual ATS-only runs.
//
// Thin, hardened handler (Engineering Plan §4.1): constant-time + fail-closed auth, per-leg
// isolation (one source failing never aborts the other), safe error mapping. Both legs upsert
// idempotently on (source, external_id), so re-running is safe.
import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/services/ats'
import { upsertJobs, isJobStoreConfigured } from '@/lib/services/jobStore'
import { upsertJobBoardJobs } from '@/lib/services/jobBoardStore'
import { authorizeCron } from '@/lib/http/cronAuth'
import { serverErrorBody } from '@/lib/http/errors'
import { JobAggregator } from '@/src/jobBoards/aggregator'

export const runtime = 'nodejs'
export const maxDuration = 120 // matches the existing ingest routes (proven to deploy here)

// Broad IT sweep. No `query` (each provider falls back to its IT-category default, maximising
// breadth) and `remote` is intentionally NOT forced — the app serves onsite/hybrid candidates too,
// so we want US onsite roles from the keyed providers, not just the remote-only free boards.
const SEARCH = { country: 'us', page: 1, pageSize: 100 } as const

async function ingestAts(now: string) {
  const results = await ingestAll()
  const jobs = results.flatMap((r) => r.jobs)
  const upserted = await upsertJobs(jobs, now)
  return {
    upserted,
    sourcesOk: results.filter((r) => r.ok).length,
    sourcesTotal: results.length,
    sources: results.map((r) => ({
      provider: r.source.provider,
      company: r.source.company,
      ok: r.ok,
      count: r.jobs.length,
      ...(r.error ? { error: r.error } : {}),
    })),
  }
}

async function ingestBoards(now: string) {
  // Free providers default on; keyed providers light up only when their env vars are set.
  // timeoutMs (per provider) is raised above the 15s default so the Apify scrapers (Dice/Wellfound)
  // have time to finish — the fast providers still resolve immediately, so this only affects slow ones.
  const aggregator = new JobAggregator({
    timeoutMs: 60_000,
    providers: {
      // Himalayas changed its API endpoint (the old /api/jobs now 404s) and it can't be verified
      // from CI; disabled until the new URL is confirmed (Arbeitnow/Remotive/RemoteOK cover remote).
      himalayas: { enabled: false },
      arbeitnow: { enabled: true },
      remotive: { enabled: true },
      remoteok: { enabled: true },
      ...(process.env.JSEARCH_RAPIDAPI_KEY
        ? { jsearch: { rapidApiKey: process.env.JSEARCH_RAPIDAPI_KEY } }
        : {}),
      ...(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY
        ? { adzuna: { appId: process.env.ADZUNA_APP_ID, appKey: process.env.ADZUNA_APP_KEY } }
        : {}),
      ...(process.env.USAJOBS_API_KEY
        ? {
            usajobs: {
              apiKey: process.env.USAJOBS_API_KEY,
              userAgent: process.env.USAJOBS_USER_AGENT ?? 'ScoutLane/1.0',
            },
          }
        : {}),
    },
  })

  // Apify (Dice + Wellfound) is dynamically imported so apify-client only loads when configured.
  if (process.env.APIFY_API_TOKEN) {
    const { ApifyProvider } = await import('@/src/jobBoards/providers/apify')
    // Cap the actor run just under the aggregator's per-provider timeout so a slow scrape fails as a
    // clean timeout rather than hanging the whole cron.
    aggregator.addProvider(new ApifyProvider({ apiToken: process.env.APIFY_API_TOKEN, actorTimeoutMs: 55_000 }))
  }

  const result = await aggregator.search(SEARCH)
  const upserted = await upsertJobBoardJobs(result.jobs, now)
  return {
    upserted,
    sourcesOk: result.sources.filter((s) => !s.error).length,
    sourcesTotal: result.sources.length,
    durationMs: result.durationMs,
    sources: result.sources,
  }
}

export async function POST(request: Request) {
  try {
    const auth = authorizeCron(request)
    if (auth === 'unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (auth === 'misconfigured') {
      console.error('[ingest-all] refused: CRON_SECRET is not set in production')
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

    const now = new Date().toISOString()
    // Run both legs concurrently; isolate failures so one bad leg can't sink the other.
    const [atsSettled, boardsSettled] = await Promise.allSettled([ingestAts(now), ingestBoards(now)])

    const ats =
      atsSettled.status === 'fulfilled'
        ? { ok: true, ...atsSettled.value }
        : { ok: false, error: errMsg(atsSettled.reason) }
    const boards =
      boardsSettled.status === 'fulfilled'
        ? { ok: true, ...boardsSettled.value }
        : { ok: false, error: errMsg(boardsSettled.reason) }

    const atsUpserted = atsSettled.status === 'fulfilled' ? atsSettled.value.upserted : 0
    const boardsUpserted = boardsSettled.status === 'fulfilled' ? boardsSettled.value.upserted : 0
    const upserted = atsUpserted + boardsUpserted
    console.log(`[ingest-all] done: ${upserted} upserted (ats ${ats.ok}, boards ${boards.ok})`)
    return NextResponse.json({ upserted, ats, boards }, { status: 200 })
  } catch (err) {
    console.error('[ingest-all] failed', err)
    return NextResponse.json(serverErrorBody(err, null), { status: 500 })
  }
}

function errMsg(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

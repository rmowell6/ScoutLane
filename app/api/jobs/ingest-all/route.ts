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
import { upsertJobs, pruneStaleJobs, isJobStoreConfigured } from '@/lib/services/jobStore'
import { upsertJobBoardJobs } from '@/lib/services/jobBoardStore'
import { cleanupOldDocs, isStorageConfigured } from '@/lib/storage'
import { isApifyDay } from '@/lib/ingest/apifySchedule'
import { authorizeCron } from '@/lib/http/cronAuth'
import { serverErrorBody } from '@/lib/http/errors'
import { JobAggregator } from '@/src/jobBoards/aggregator'

export const runtime = 'nodejs'
export const maxDuration = 120 // matches the existing ingest routes (proven to deploy here)

// Retention: a posting unseen by every feed for this long is treated as gone and pruned from the
// pool. Wide enough to survive a transient provider outage (a job blips out for a day or two and
// comes back) without letting dead listings accumulate. Generated packet files are abandoned far
// sooner — their signed download URLs expire in an hour — so they sweep on a 1-day window.
const JOB_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DOC_RETENTION_MS = 24 * 60 * 60 * 1000

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
      // Himalayas OFF: the /jobs/api browse feed has a different JSON shape than the vendored
      // mapper expects, so it emitted url-less jobs. Re-enable once the mapping matches a real
      // browse-feed payload (paste a sample and I'll fix the field mapping).
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

  // Apify (Dice + Wellfound) is METERED against a $5/month free credit — Wellfound is $0.99/run flat
  // and Dice ~$0.004/result — so unlike the free boards above it CANNOT run every day (30 daily runs
  // would cost ~$30 and blow the credit). It instead runs only on the fixed days-of-month in
  // apifyDays() (default 1/11/21 → exactly 3 runs ≈ $4.17, comfortably under $5 with headroom, and
  // those three days exist in every month so the count never surprises). Master switch stays
  // APIFY_INGEST=on; cadence is tunable via APIFY_INGEST_DAYS without a code change.
  const apifyToken = process.env.APIFY_API_TOKEN
  const runApify = Boolean(apifyToken) && process.env.APIFY_INGEST === 'on' && isApifyDay(now)
  if (runApify && apifyToken) {
    const { ApifyProvider } = await import('@/src/jobBoards/providers/apify')
    // Cap the actor run just under the aggregator's per-provider timeout so a slow scrape fails as a
    // clean timeout rather than hanging the whole cron.
    aggregator.addProvider(new ApifyProvider({ apiToken: apifyToken, actorTimeoutMs: 55_000 }))
  }

  const result = await aggregator.search(SEARCH)
  const upserted = await upsertJobBoardJobs(result.jobs, now)
  return {
    upserted,
    apifyRan: runApify,
    sourcesOk: result.sources.filter((s) => !s.error).length,
    sourcesTotal: result.sources.length,
    durationMs: result.durationMs,
    sources: result.sources,
  }
}

// Vercel Cron invokes the configured path with an HTTP GET (and auto-attaches
// `Authorization: Bearer $CRON_SECRET`), so the scheduled refresh MUST be reachable via GET — a
// POST-only handler returns 405 before any code runs and the cron silently never ingests. We export
// both: GET for the scheduler, POST for manual/curl runs. authorizeCron reads the header either way.
async function handleIngestAll(request: Request) {
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

    // Housekeeping runs AFTER both legs upsert (so live postings just got `validated_at = now` and
    // won't be pruned) and is isolated: a cleanup failure must not fail the ingest the cron exists
    // to do. Each leg reports its own ok/result so a problem is visible without sinking the response.
    const cutoffIso = new Date(Date.now() - JOB_RETENTION_MS).toISOString()
    const [pruneSettled, docsSettled] = await Promise.allSettled([
      pruneStaleJobs(cutoffIso),
      isStorageConfigured() ? cleanupOldDocs(DOC_RETENTION_MS) : Promise.resolve(0),
    ])
    const prunedJobs =
      pruneSettled.status === 'fulfilled'
        ? { ok: true, removed: pruneSettled.value }
        : { ok: false, error: errMsg(pruneSettled.reason) }
    const prunedDocs =
      docsSettled.status === 'fulfilled'
        ? { ok: true, removed: docsSettled.value }
        : { ok: false, error: errMsg(docsSettled.reason) }

    console.log(
      `[ingest-all] done: ${upserted} upserted (ats ${ats.ok}, boards ${boards.ok}); ` +
        `pruned ${prunedJobs.ok ? prunedJobs.removed : 'failed'} jobs, ` +
        `${prunedDocs.ok ? prunedDocs.removed : 'failed'} docs`,
    )
    return NextResponse.json({ upserted, ats, boards, prunedJobs, prunedDocs }, { status: 200 })
  } catch (err) {
    console.error('[ingest-all] failed', err)
    return NextResponse.json(serverErrorBody(err, null), { status: 500 })
  }
}

export const GET = handleIngestAll
export const POST = handleIngestAll

function errMsg(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

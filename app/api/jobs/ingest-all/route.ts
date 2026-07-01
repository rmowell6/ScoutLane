// POST /api/jobs/ingest-all, the UNIFIED cron ingest. Refreshes the whole `jobs` pool in one
// run: the ATS boards (Greenhouse/Lever/Ashby) AND the job-board aggregator (Himalayas, Arbeitnow,
// Remotive, RemoteOK + keyed: JSearch, Adzuna, USAJobs, Apify). A single daily Vercel cron points
// here (vercel.json). The existing /api/jobs/ingest stays for manual ATS-only runs.
//
// Thin, hardened handler (Engineering Plan §4.1): constant-time + fail-closed auth, per-leg
// isolation (one source failing never aborts the other), safe error mapping. Both legs upsert
// idempotently on (source, external_id), so re-running is safe.
import { NextResponse } from 'next/server'
import { ingestAll } from '@/lib/services/ats'
import { upsertJobs, expireStaleJobs, reclaimExpiredJobs, isJobStoreConfigured } from '@/lib/services/jobStore'
import { upsertJobBoardJobs } from '@/lib/services/jobBoardStore'
import { cleanupOldDocs, isStorageConfigured } from '@/lib/storage'
import { isApifyDay } from '@/lib/ingest/apifySchedule'
import { claimApifyRun } from '@/lib/ingest/apifyRunLock'
import { prunableAtsProviders, prunableBoardSources } from '@/lib/ingest/prunePlan'
import { authorizeCron } from '@/lib/http/cronAuth'
import { purgeExpiredRateLimits } from '@/lib/http/rateLimit'
import { serverErrorBody } from '@/lib/http/errors'
import { JobAggregator } from '@/src/jobBoards/aggregator'

export const runtime = 'nodejs'
export const maxDuration = 120 // matches the existing ingest routes (proven to deploy here)

// Retention: a posting from a source confirmed live this run but unseen for this long is soft-
// expired (reversibly hidden). Wide enough to survive a transient provider outage (a job blips out
// for a day or two and comes back) without hiding still-live jobs. Expired rows are physically
// reclaimed only after the much longer RECLAIM window, so a wrongly-expired posting has a long grace
// period to reappear first. Generated packet files are abandoned far sooner, their signed download
// URLs expire in an hour, so they sweep on a 1-day window.
const JOB_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const JOB_RECLAIM_MS = 30 * 24 * 60 * 60 * 1000
const DOC_RETENTION_MS = 24 * 60 * 60 * 1000

// Broad IT sweep. No `query` (each provider falls back to its IT-category default, maximising
// breadth) and `remote` is intentionally NOT forced, the app serves onsite/hybrid candidates too,
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
  // have time to finish, the fast providers still resolve immediately, so this only affects slow ones.
  const aggregator = new JobAggregator({
    timeoutMs: 60_000,
    providers: {
      // Himalayas OFF: the /jobs/api browse feed has a different JSON shape than the vendored
      // mapper expects, so it emitted url-less jobs. Re-enable once the mapping matches a real
      // browse-feed payload (paste a sample and I'll fix the field mapping).
      himalayas: { enabled: false },
      // Arbeitnow OFF: it is a German/EU job board, and ScoutLane is US-market only, keeping it on
      // just fetches EU roles we then discard at the US ingest filter. Re-enable if/when we expand
      // beyond the US.
      arbeitnow: { enabled: false },
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

  // Apify (Dice + Wellfound) is METERED against a $5/month free credit, Wellfound is $0.99/run flat
  // and Dice ~$0.004/result, so unlike the free boards above it CANNOT run every day (30 daily runs
  // would cost ~$30 and blow the credit). It instead runs only on the fixed days-of-month in
  // apifyDays() (default 1/11/21 → exactly 3 runs ≈ $4.17, comfortably under $5 with headroom, and
  // those three days exist in every month so the count never surprises). Master switch stays
  // APIFY_INGEST=on; cadence is tunable via APIFY_INGEST_DAYS without a code change.
  // claimApifyRun is the LAST, atomic condition (short-circuited so it only runs on an enabled Apify
  // day), it claims a per-UTC-day marker so a cron double-fire or post-timeout re-entry can't bill
  // the metered actors twice. It fails closed (no claim -> no spend). The free boards above are
  // unmetered and run every invocation regardless.
  const apifyToken = process.env.APIFY_API_TOKEN
  const runApify =
    Boolean(apifyToken) &&
    process.env.APIFY_INGEST === 'on' &&
    isApifyDay(now) &&
    (await claimApifyRun(now))
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
// `Authorization: Bearer $CRON_SECRET`), so the scheduled refresh MUST be reachable via GET, a
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
        : { ok: false, error: legError(atsSettled.reason) }
    const boards =
      boardsSettled.status === 'fulfilled'
        ? { ok: true, ...boardsSettled.value }
        : { ok: false, error: legError(boardsSettled.reason) }

    const atsUpserted = atsSettled.status === 'fulfilled' ? atsSettled.value.upserted : 0
    const boardsUpserted = boardsSettled.status === 'fulfilled' ? boardsSettled.value.upserted : 0
    const upserted = atsUpserted + boardsUpserted

    // Housekeeping runs AFTER both legs upsert and is isolated (a cleanup failure must not fail the
    // ingest the cron exists to do). NOTE (cloud-8): the legs run in parallel but housekeeping runs
    // after them serially, so on a slow day it can be cut off by the 120s budget, accepted, because
    // expire/reclaim/sweep are all idempotent and simply run on the next daily invocation.
    // Retention is gated on CONFIRMED re-observation: only sources
    // that actually succeeded this run are eligible to soft-expire their stale rows, a failed
    // provider/leg is excluded, so its still-live postings can never be aged out by a run that never
    // saw it. Expire is reversible (the next successful upsert un-expires); physical reclaim of
    // long-expired rows is a separate, much-later stage.
    const atsSources = atsSettled.status === 'fulfilled' ? atsSettled.value.sources : []
    const boardSources = boardsSettled.status === 'fulfilled' ? boardsSettled.value.sources : []
    const prunableSources = [...prunableAtsProviders(atsSources), ...prunableBoardSources(boardSources)]

    const expireCutoffIso = new Date(Date.now() - JOB_RETENTION_MS).toISOString()
    const reclaimCutoffIso = new Date(Date.now() - JOB_RECLAIM_MS).toISOString()
    const [expireSettled, reclaimSettled, docsSettled, rateLimitSettled] = await Promise.allSettled([
      expireStaleJobs(prunableSources, expireCutoffIso),
      reclaimExpiredJobs(reclaimCutoffIso),
      isStorageConfigured() ? cleanupOldDocs(DOC_RETENTION_MS) : Promise.resolve(0),
      purgeExpiredRateLimits(), // P2/R-7: bound rate_limit_counters growth
    ])
    if (rateLimitSettled.status === 'rejected') {
      console.warn('[ingest-all] rate-limit purge failed', legError(rateLimitSettled.reason))
    }
    const expiredJobs =
      expireSettled.status === 'fulfilled'
        ? { ok: true, expired: expireSettled.value, sources: prunableSources }
        : { ok: false, error: legError(expireSettled.reason) }
    const reclaimedJobs =
      reclaimSettled.status === 'fulfilled'
        ? { ok: true, removed: reclaimSettled.value }
        : { ok: false, error: legError(reclaimSettled.reason) }
    const prunedDocs =
      docsSettled.status === 'fulfilled'
        ? { ok: true, removed: docsSettled.value }
        : { ok: false, error: legError(docsSettled.reason) }

    // Observability (reliability-38): make a bad run alertable instead of a silent 200. A TOTAL
    // failure (both legs failed) returns 500 so it surfaces on the Vercel cron dashboard and to any
    // uptime monitor; a partial run stays 200 but carries `degraded: true` (also set when nothing was
    // upserted) so a body-inspecting monitor can alert without the run looking healthy.
    const totalFailure = !ats.ok && !boards.ok
    const degraded = totalFailure || upserted === 0
    console.log(
      `[ingest-all] done: ${upserted} upserted (ats ${ats.ok}, boards ${boards.ok}, degraded ${degraded}); ` +
        `expired ${expiredJobs.ok ? expiredJobs.expired : 'failed'} jobs, ` +
        `reclaimed ${reclaimedJobs.ok ? reclaimedJobs.removed : 'failed'}, ` +
        `${prunedDocs.ok ? prunedDocs.removed : 'failed'} docs`,
    )
    return NextResponse.json(
      { upserted, degraded, ats, boards, expiredJobs, reclaimedJobs, prunedDocs },
      { status: totalFailure ? 500 : 200 },
    )
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

// A failed leg's raw reason can carry internal detail (a JobStoreError wraps DB messages). This
// route is CRON_SECRET-gated, but redact in production anyway (defense-in-depth, consistent with
// serverErrorBody), the full error is always logged server-side. Per-source provider statuses
// inside ats/boards are upstream-origin and bounded, so they're left as-is for the cron report.
const isProd = process.env.NODE_ENV === 'production'
function legError(reason: unknown): string {
  return isProd ? 'upstream error (see server logs)' : errMsg(reason)
}

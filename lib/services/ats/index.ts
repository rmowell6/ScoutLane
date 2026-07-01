// ATS ingestion orchestrator (M3): fetch every configured board, normalize, and roll up a
// per-source report. One bad board (404, blocked domain, payload change) is isolated to its own
// SourceResult.ok=false with a message, it never aborts the whole ingest (CLAUDE.md: localize
// failures, never swallow them).
import { greenhouseUrl, parseGreenhouse } from './greenhouse'
import { leverUrl, parseLever } from './lever'
import { ashbyUrl, parseAshby } from './ashby'
import { fetchJsonConditional } from './fetchJson'
import { getIngestState, saveIngestState, touchIngestState } from './ingestState'
import { touchJobsValidatedAt } from '@/lib/services/jobStore'
import { SOURCES } from './sources'
import type { AtsProvider, AtsSource, IngestedJob, SourceResult } from './types'

/** Per-provider feed URL + payload parser, so the orchestrator can run one conditional GET and parse
 *  the result generically (the fetchX helpers remain the simple unconditional API for unit tests). */
const PROVIDERS: Record<
  AtsProvider,
  { url: (s: AtsSource) => string; parse: (raw: unknown, s: AtsSource) => IngestedJob[] }
> = {
  greenhouse: { url: (s) => greenhouseUrl(s.token), parse: parseGreenhouse },
  lever: { url: (s) => leverUrl(s.token), parse: parseLever },
  ashby: { url: (s) => ashbyUrl(s.token), parse: parseAshby },
}

/** Per-board cache key for the stored ETag / Last-Modified. One row per feed. */
function sourceKey(s: AtsSource): string {
  return `${s.provider}:${s.token}`
}

/**
 * Fetch one source with conditional GET, catching everything into a SourceResult. On a 304 the board
 * is unchanged: we skip the download+parse, re-stamp its live rows' validated_at so the per-provider
 * expiry can't age them out, and bump the check timestamp. On a 200 we parse as before and store the
 * fresh validators for next run.
 */
async function fetchSource(source: AtsSource): Promise<SourceResult> {
  const start = Date.now()
  const key = sourceKey(source)
  const provider = PROVIDERS[source.provider]
  try {
    // State read is best-effort (null on miss / unconfigured / error) -> a normal unconditional GET.
    const state = await getIngestState(key)
    const result = await fetchJsonConditional(provider.url(source), {
      etag: state?.etag ?? null,
      lastModified: state?.lastModified ?? null,
    })

    if (result.status === 'not-modified') {
      // Re-stamp BEFORE reporting ok: if the re-stamp fails, we fall through to the catch and report
      // the source as not-ok, which conservatively drops it from the prune set (never expires rows).
      const restamped = await touchJobsValidatedAt(source.provider, source.company, new Date().toISOString())
      await touchIngestState(key) // bookkeeping only; best-effort inside the store
      console.log(`[ingest] ${key}: not modified, skipped (${restamped} rows kept, ${Date.now() - start}ms)`)
      return { source, ok: true, jobs: [], notModified: true }
    }

    const jobs = provider.parse(result.data, source)
    await saveIngestState(key, { etag: result.etag, lastModified: result.lastModified })
    console.log(`[ats] source ok: ${source.provider}/${source.token} -> ${jobs.length} jobs (${Date.now() - start}ms)`)
    return { source, ok: true, jobs }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[ats] source failed: ${source.provider}/${source.token} (${Date.now() - start}ms)`, error)
    return { source, ok: false, jobs: [], error }
  }
}

/** Fetch a given list of sources concurrently. */
export async function ingestSources(sources: AtsSource[]): Promise<SourceResult[]> {
  return Promise.all(sources.map(fetchSource))
}

/** Fetch the configured seed pool. */
export async function ingestAll(): Promise<SourceResult[]> {
  return ingestSources(SOURCES)
}

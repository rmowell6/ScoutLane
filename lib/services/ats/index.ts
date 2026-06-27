// ATS ingestion orchestrator (M3): fetch every configured board, normalize, and roll up a
// per-source report. One bad board (404, blocked domain, payload change) is isolated to its own
// SourceResult.ok=false with a message — it never aborts the whole ingest (CLAUDE.md: localize
// failures, never swallow them).
import { fetchGreenhouse } from './greenhouse'
import { fetchLever } from './lever'
import { fetchAshby } from './ashby'
import { SOURCES } from './sources'
import type { AtsProvider, AtsSource, IngestedJob, SourceResult } from './types'

const FETCHERS: Record<AtsProvider, (s: AtsSource) => Promise<IngestedJob[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
}

/** Fetch one source, catching everything into a SourceResult. */
async function fetchSource(source: AtsSource): Promise<SourceResult> {
  const start = Date.now()
  try {
    const jobs = await FETCHERS[source.provider](source)
    console.log(
      `[ats] source ok: ${source.provider}/${source.token} -> ${jobs.length} jobs (${Date.now() - start}ms)`,
    )
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

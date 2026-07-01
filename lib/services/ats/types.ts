// Shared types for ATS ingestion (M3). Each provider fetcher normalizes its public board JSON
// into IngestedJob[]; the orchestrator upserts them into the `jobs` table.
export type AtsProvider = 'greenhouse' | 'lever' | 'ashby'

/** One normalized open role, ready to upsert. `externalId` is unique within a provider. */
export interface IngestedJob {
  provider: AtsProvider
  externalId: string
  title: string
  company: string
  location: string | null
  url: string
  /** Plain-text job description, assembled from the provider payload. */
  jdText: string
}

/** A board to ingest: which provider + the board token/company slug in its public API. */
export interface AtsSource {
  provider: AtsProvider
  /** Board token (Greenhouse/Ashby) or company slug (Lever). */
  token: string
  /** Human-facing company label for the pool (providers don't always supply one per job). */
  company: string
}

/** Outcome of fetching one source, always returned, never thrown, so one bad board can't
 *  abort the whole ingest. The orchestrator rolls these up into a report. */
export interface SourceResult {
  source: AtsSource
  ok: boolean
  jobs: IngestedJob[]
  error?: string
  /** True when the board answered 304 (unchanged): jobs is empty because we skipped the fetch+parse,
   *  and the board's live rows were re-stamped instead. Distinguishes "unchanged" from "zero jobs". */
  notModified?: boolean
}

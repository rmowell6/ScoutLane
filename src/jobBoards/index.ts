// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Job Boards Module
// Public API
//
// NOTE: the in-memory/file cache layer (MemoryCache/FileCache/CachedAggregator) that shipped with
// the original module was removed — ScoutLane caches via the Supabase `jobs` table (the daily cron
// is the only thing that hits provider APIs), so those classes were dead code and a read-only-FS
// trap on serverless. Use JobAggregator directly.
// ─────────────────────────────────────────────────────────────────────────────

// ── Aggregator ───────────────────────────────────────────────────────────────

export { JobAggregator, deduplicateJobs } from './aggregator';
export type { AggregatedResult, SourceStatus } from './aggregator';

// ── Providers ─────────────────────────────────────────────────────────────────

// Free / no-auth
export { HimalayasProvider } from './providers/himalayas';
export { ArbeitnowProvider } from './providers/arbeitnow';
export { RemotiveProvider } from './providers/remotive';
export { RemoteOKProvider } from './providers/remoteok';

// Free API key required
export { AdzunaProvider } from './providers/adzuna';
export { USAJobsProvider } from './providers/usajobs';

// Paid / metered (JSearch covers LinkedIn + Indeed; Apify covers Dice + Wellfound)
export { JSearchProvider } from './providers/jsearch';
export { ApifyProvider } from './providers/apify';
export type { ApifyProviderConfig } from './providers/apify';

// ── Core Types ────────────────────────────────────────────────────────────────

export type {
  Job,
  JobType,
  Salary,
  SearchParams,
  JobSearchResult,
  JobBoardProvider,
  ProviderConfig,
  AdzunaConfig,
  USAJobsConfig,
  JSearchConfig,
  AggregatorConfig,
} from './types';

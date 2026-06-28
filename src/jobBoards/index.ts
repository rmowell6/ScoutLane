// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Job Boards Module
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// ── Aggregators ──────────────────────────────────────────────────────────────

export { JobAggregator } from './aggregator';
export type { AggregatedResult, SourceStatus } from './aggregator';

// Cached wrapper (recommended entry point for production use)
export { CachedAggregator } from './CachedAggregator';
export type {
  CachedAggregatorConfig,
  CachedSearchResult,
} from './CachedAggregator';

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

// ── Cache ─────────────────────────────────────────────────────────────────────

export { MemoryCache } from './cache/MemoryCache';
export type { MemoryCacheOptions } from './cache/MemoryCache';

export { FileCache } from './cache/FileCache';
export type { FileCacheOptions } from './cache/FileCache';

export { buildCacheKey, buildAggregatorKey } from './cache/key';
export type { IJobCache, CacheEntry, CacheStats } from './cache/types';
export { TTL } from './cache/types';

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

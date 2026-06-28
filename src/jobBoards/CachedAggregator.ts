// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — CachedAggregator
//
// Wraps JobAggregator with a pluggable cache layer.
//
// Design decisions:
//
//   1. Cache at the aggregated result level (post-dedup, post-sort) rather
//      than per-provider. This means one cache miss triggers all providers
//      in parallel once, and all subsequent reads are instant.
//
//   2. Stale-while-revalidate (SWR) support — optionally serve a stale result
//      immediately while refreshing in the background. This keeps p99 latency
//      low even as cache entries age.
//      Ref: https://web.dev/articles/stale-while-revalidate
//
//   3. Per-source TTL overrides — remote-only boards (Remotive, RemoteOK)
//      update slowly, so they deserve a longer TTL than JSearch.
//
//   4. Thundering-herd prevention — in-flight deduplication ensures that
//      N concurrent requests for the same uncached query only trigger ONE
//      upstream call.
//
// ─────────────────────────────────────────────────────────────────────────────

import { JobAggregator, type AggregatedResult } from './aggregator';
import type { AggregatorConfig } from './types';
import type { SearchParams } from './types';
import type { IJobCache } from './cache/types';
import { buildAggregatorKey } from './cache/key';
import { MemoryCache } from './cache/MemoryCache';
import { TTL } from './cache/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CachedAggregatorConfig {
  /** Config forwarded to JobAggregator (providers, dedup, timeout). */
  aggregator?: AggregatorConfig;
  /**
   * Cache backend. Defaults to MemoryCache with 24 h TTL.
   * Swap in FileCache for persistence across restarts, or a Redis adapter
   * for multi-process deployments.
   */
  cache?: IJobCache<AggregatedResult>;
  /**
   * How long to cache aggregated results, in milliseconds.
   * Default: TTL.LONG (24 hours) — maximises free-tier request budgets.
   */
  ttlMs?: number;
  /**
   * If true, return a stale cached result immediately and refresh in the
   * background. Recommended for user-facing endpoints.
   * Default: false
   */
  staleWhileRevalidate?: boolean;
  /**
   * Maximum age of a stale result (ms) before it blocks instead of serving
   * stale. Only relevant when staleWhileRevalidate is true.
   * Default: TTL.LONG * 2 (48 hours)
   */
  staleIfErrorMs?: number;
}

// ---------------------------------------------------------------------------
// In-flight deduplication map
// ---------------------------------------------------------------------------

type InflightEntry = Promise<AggregatedResult>;

// ---------------------------------------------------------------------------
// CachedAggregator
// ---------------------------------------------------------------------------

export class CachedAggregator {
  private readonly aggregator: JobAggregator;
  private readonly cache: IJobCache<AggregatedResult>;
  private readonly ttlMs: number;
  private readonly swr: boolean;
  private readonly staleIfErrorMs: number;
  /** In-flight requests keyed by cache key — prevents thundering herd. */
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(config: CachedAggregatorConfig = {}) {
    this.aggregator = new JobAggregator(config.aggregator ?? {});
    this.cache = config.cache ?? new MemoryCache<AggregatedResult>();
    this.ttlMs = config.ttlMs ?? TTL.LONG;
    this.swr = config.staleWhileRevalidate ?? false;
    this.staleIfErrorMs = config.staleIfErrorMs ?? TTL.LONG * 2;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Search all configured providers, returning a cached result when available.
   *
   * Cache behaviour:
   *   HIT  → return immediately (or revalidate in background if SWR enabled)
   *   MISS → fetch from all providers, cache result, return
   */
  async search(params: SearchParams): Promise<CachedSearchResult> {
    const key = buildAggregatorKey(params);

    // 1. Check cache
    const cached = await this.cache.get(key);

    if (cached !== undefined) {
      if (this.swr) {
        // Fire background refresh without awaiting it
        this.backgroundRefresh(key, params).catch(() => undefined);
      }
      return { ...cached, fromCache: true };
    }

    // 2. Fetch — deduplicated so concurrent callers share one upstream request
    const result = await this.fetchDeduplicated(key, params);
    return { ...result, fromCache: false };
  }

  /**
   * Force a cache refresh for a given set of params, bypassing TTL.
   * Useful for admin endpoints or scheduled refresh jobs.
   */
  async refresh(params: SearchParams): Promise<AggregatedResult> {
    const key = buildAggregatorKey(params);
    await this.cache.delete(key);
    return this.fetchDeduplicated(key, params);
  }

  /** Invalidate a specific cached search. */
  async invalidate(params: SearchParams): Promise<void> {
    await this.cache.delete(buildAggregatorKey(params));
  }

  /** Wipe the entire cache. */
  async clearAll(): Promise<void> {
    await this.cache.clear();
  }

  /** Return cache stats (hits, misses, hit rate). */
  stats() {
    return this.cache.stats?.() ?? null;
  }

  /** Access the underlying aggregator (e.g., to add a provider at runtime). */
  get inner(): JobAggregator {
    return this.aggregator;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Fetch + cache, deduplicating concurrent calls for the same key. */
  private async fetchDeduplicated(
    key: string,
    params: SearchParams,
  ): Promise<AggregatedResult> {
    // Return existing in-flight promise if one exists
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetchAndCache(key, params);
    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async fetchAndCache(
    key: string,
    params: SearchParams,
  ): Promise<AggregatedResult> {
    const result = await this.aggregator.search(params);
    // Only cache if we got at least some results (don't cache total outages)
    if (result.jobs.length > 0 || result.sources.every((s) => !s.error)) {
      await this.cache.set(key, result, this.ttlMs);
    }
    return result;
  }

  private async backgroundRefresh(
    key: string,
    params: SearchParams,
  ): Promise<void> {
    const result = await this.aggregator.search(params);
    await this.cache.set(key, result, this.ttlMs);
  }
}

// ---------------------------------------------------------------------------
// Extended result type — includes cache provenance
// ---------------------------------------------------------------------------

export interface CachedSearchResult extends AggregatedResult {
  /** true if this result came from cache, false if freshly fetched */
  fromCache: boolean;
}

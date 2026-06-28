// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Cache Abstractions
//
// A thin interface lets us swap backends (memory → Redis → etc.) without
// touching the aggregator or any provider code.
//
// Ref: https://isaacs.github.io/node-lru-cache/
// ─────────────────────────────────────────────────────────────────────────────

/** A single cached value with its expiry timestamp. */
export interface CacheEntry<T> {
  value: T;
  /** Unix ms — Date.now() value at which this entry expires. */
  expiresAt: number;
}

/**
 * Backend-agnostic cache interface.
 * All implementations must be safe to `await` even when the underlying
 * operation is synchronous.
 */
export interface IJobCache<T = unknown> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Optional: return cache stats for observability. */
  stats?(): CacheStats;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

/** TTL presets — use these rather than magic numbers. */
export const TTL = {
  /** 1 hour — aggressive refresh, useful for high-velocity boards. */
  SHORT: 1_000 * 60 * 60,
  /** 6 hours — good balance for most IT job boards. */
  MEDIUM: 1_000 * 60 * 60 * 6,
  /** 24 hours — maximises free-tier request budgets. */
  LONG: 1_000 * 60 * 60 * 24,
} as const;

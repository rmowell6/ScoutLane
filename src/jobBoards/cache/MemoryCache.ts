// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — In-Memory LRU Cache
//
// Uses `lru-cache` v10+ — the de-facto standard for in-memory caching in
// Node.js. TypeScript-native, zero-dependency, used by npm itself.
//
// Install: npm install lru-cache
// Ref: https://isaacs.github.io/node-lru-cache/
//      https://github.com/isaacs/node-lru-cache#readme
//
// Sizing strategy: we cap by byte size (maxSize) rather than item count so
// that large job-description payloads don't silently evict cached results.
// A 50 MB ceiling is conservative and well within Node's default heap.
// ─────────────────────────────────────────────────────────────────────────────

import { LRUCache } from 'lru-cache';
import type { IJobCache, CacheStats } from './types';

export interface MemoryCacheOptions {
  /**
   * Maximum number of entries before LRU eviction kicks in.
   * Default: 500 — enough for hundreds of unique search queries.
   */
  max?: number;
  /**
   * Hard byte ceiling for the entire cache.
   * Default: 50 MB.
   */
  maxSizeBytes?: number;
  /**
   * Default TTL in ms. Can be overridden per-set() call.
   * Default: 24 hours.
   */
  defaultTtlMs?: number;
}

export class MemoryCache<T = unknown> implements IJobCache<T> {
  private readonly cache: LRUCache<string, T>;
  private hits = 0;
  private misses = 0;

  constructor(options: MemoryCacheOptions = {}) {
    const {
      max = 500,
      maxSizeBytes = 50 * 1024 * 1024, // 50 MB
      defaultTtlMs = 1_000 * 60 * 60 * 24, // 24 h
    } = options;

    this.cache = new LRUCache<string, T>({
      max,
      // Byte-based size tracking — more accurate than item count
      // Ref: https://isaacs.github.io/node-lru-cache/#--maxsize-number
      maxSize: maxSizeBytes,
      sizeCalculation: (value) => {
        try {
          return Buffer.byteLength(JSON.stringify(value), 'utf8');
        } catch {
          return 1024; // Fallback: 1 KB per item
        }
      },
      // Treat TTL as a hard expiry, not just eviction preference
      // Ref: https://isaacs.github.io/node-lru-cache/#--ttlresolution-number
      ttl: defaultTtlMs,
      ttlResolution: 30_000, // check expiry every 30 s
      allowStale: false,     // never serve expired items
      updateAgeOnGet: false, // TTL ticks from write, not last read
      updateAgeOnHas: false,
    });
  }

  async get(key: string): Promise<T | undefined> {
    const value = this.cache.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return value;
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    this.cache.set(key, value, { ttl: ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** Expose the raw lru-cache instance for advanced use (e.g., iterating). */
  get raw(): LRUCache<string, T> {
    return this.cache;
  }
}

// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Cache Module Exports
// ─────────────────────────────────────────────────────────────────────────────

export { MemoryCache } from './MemoryCache';
export type { MemoryCacheOptions } from './MemoryCache';

export { FileCache } from './FileCache';
export type { FileCacheOptions } from './FileCache';

export { buildCacheKey, buildAggregatorKey } from './key';

export type { IJobCache, CacheEntry, CacheStats } from './types';
export { TTL } from './types';

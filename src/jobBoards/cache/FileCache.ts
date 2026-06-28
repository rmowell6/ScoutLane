// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — File-System Cache
//
// Persists cache entries as individual JSON files so results survive server
// restarts. Ideal for POC/development — no Redis or external services needed.
//
// Layout on disk:
//   <cacheDir>/
//     <key>.json   →  { value: T, expiresAt: number }
//
// Each file is written atomically (write-to-tmp then rename) to avoid
// partial reads if the process crashes mid-write.
//
// Ref: https://nodejs.org/api/fs.html#fspromisesrenamepath-newpath
//      https://nodejs.org/api/fs.html#file-system-flags (atomic write pattern)
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CacheEntry, IJobCache, CacheStats } from './types';

export interface FileCacheOptions {
  /**
   * Directory to store cache files.
   * Default: <os.tmpdir()>/scoutlane-job-cache
   */
  cacheDir?: string;
  /**
   * Run a sweep for expired files on startup.
   * Default: true
   */
  pruneOnStart?: boolean;
}

export class FileCache<T = unknown> implements IJobCache<T> {
  private readonly cacheDir: string;
  private readonly ready: Promise<void>;
  private hits = 0;
  private misses = 0;

  constructor(options: FileCacheOptions = {}) {
    this.cacheDir =
      options.cacheDir ??
      path.join(os.tmpdir(), 'scoutlane-job-cache');

    this.ready = this.init(options.pruneOnStart ?? true);
  }

  // ---------------------------------------------------------------------------
  // IJobCache implementation
  // ---------------------------------------------------------------------------

  async get(key: string): Promise<T | undefined> {
    await this.ready;
    const filePath = this.keyToPath(key);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const entry = JSON.parse(raw) as CacheEntry<T>;

      if (Date.now() > entry.expiresAt) {
        // Expired — delete lazily and return miss
        fs.unlink(filePath).catch(() => undefined);
        this.misses++;
        return undefined;
      }

      this.hits++;
      return entry.value;
    } catch (err: unknown) {
      // File not found → cache miss (not an error)
      if (isNodeError(err) && err.code === 'ENOENT') {
        this.misses++;
        return undefined;
      }
      // Corrupt file → treat as miss + delete
      fs.unlink(filePath).catch(() => undefined);
      this.misses++;
      return undefined;
    }
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    await this.ready;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };

    const filePath = this.keyToPath(key);
    // Atomic write: write to a temp file, then rename
    // Ref: https://nodejs.org/api/fs.html#fspromisesrenamepath-newpath
    const tmpPath = `${filePath}.tmp`;

    try {
      await fs.writeFile(tmpPath, JSON.stringify(entry), 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch {
      // Cleanup tmp on failure
      fs.unlink(tmpPath).catch(() => undefined);
    }
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    fs.unlink(this.keyToPath(key)).catch(() => undefined);
  }

  async clear(): Promise<void> {
    await this.ready;
    const files = await fs.readdir(this.cacheDir).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => fs.unlink(path.join(this.cacheDir, f)).catch(() => undefined)),
    );
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: -1, // Would need a readdir to count — skip for perf
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async init(pruneOnStart: boolean): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    if (pruneOnStart) {
      // Fire-and-forget: don't block startup
      this.pruneExpired().catch(() => undefined);
    }
  }

  /**
   * Remove all expired files. Call on startup or periodically via a cron.
   */
  async pruneExpired(): Promise<number> {
    let pruned = 0;
    const files = await fs.readdir(this.cacheDir).catch(() => [] as string[]);

    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          const filePath = path.join(this.cacheDir, f);
          try {
            const raw = await fs.readFile(filePath, 'utf8');
            const entry = JSON.parse(raw) as CacheEntry<unknown>;
            if (Date.now() > entry.expiresAt) {
              await fs.unlink(filePath);
              pruned++;
            }
          } catch {
            // Corrupt or unreadable — delete it
            fs.unlink(filePath).catch(() => undefined);
            pruned++;
          }
        }),
    );

    return pruned;
  }

  /** Map a cache key to a safe file path. */
  private keyToPath(key: string): string {
    // Key is already base64url encoded (from key.ts) — safe for filenames
    // Truncate to 200 chars to stay within POSIX filename limits
    const safeKey = key.replace(/[^a-zA-Z0-9_\-.:]/g, '_').slice(0, 200);
    return path.join(this.cacheDir, `${safeKey}.json`);
  }
}

// ---------------------------------------------------------------------------
// Type guard for Node.js errors
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

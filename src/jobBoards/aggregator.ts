// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Job Aggregator
// Queries all configured providers in parallel, deduplicates, and sorts.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  AggregatorConfig,
} from './types';

import { AdzunaProvider } from './providers/adzuna';
import { HimalayasProvider } from './providers/himalayas';
import { ArbeitnowProvider } from './providers/arbeitnow';
import { RemotiveProvider } from './providers/remotive';
import { RemoteOKProvider } from './providers/remoteok';
import { USAJobsProvider } from './providers/usajobs';
import { JSearchProvider } from './providers/jsearch';

// ---------------------------------------------------------------------------
// Aggregated result
// ---------------------------------------------------------------------------

export interface AggregatedResult {
  jobs: Job[];
  total: number;
  sources: SourceStatus[];
  durationMs: number;
}

export interface SourceStatus {
  name: string;
  count: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Remove duplicate jobs. Strategy:
 * 1. Exact URL match → keep highest-quality source
 * 2. Fuzzy match on normalised title + company → keep most recent
 */
function deduplicateJobs(jobs: Job[]): Job[] {
  const byUrl = new Map<string, Job>();
  const byKey = new Map<string, Job>();

  // Provider priority (higher index = preferred when deduping)
  const PRIORITY = [
    'arbeitnow',
    'remoteok',
    'remotive',
    'himalayas',
    'usajobs',
    'adzuna',
    'jsearch',
  ];

  const priority = (source: string) => PRIORITY.indexOf(source);

  for (const job of jobs) {
    // URL dedup
    const normUrl = job.url.split('?')[0].toLowerCase();
    const existing = byUrl.get(normUrl);
    if (existing) {
      if (priority(job.source) > priority(existing.source)) {
        byUrl.set(normUrl, job);
      }
      continue;
    }
    byUrl.set(normUrl, job);

    // Fuzzy dedup: title + company
    const fuzzyKey = `${job.title.toLowerCase().replace(/\W+/g, '')}|${job.company
      .toLowerCase()
      .replace(/\W+/g, '')}`;

    const existingFuzzy = byKey.get(fuzzyKey);
    if (existingFuzzy) {
      // Keep the newer posting
      const keep = job.postedAt > existingFuzzy.postedAt ? job : existingFuzzy;
      byKey.set(fuzzyKey, keep);
    } else {
      byKey.set(fuzzyKey, job);
    }
  }

  // Union: keep anything that survived both passes
  const urlSet = new Set(byUrl.values());
  const fuzzySet = new Set(byKey.values());
  return [...new Set([...urlSet].filter((j) => fuzzySet.has(j)))];
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export class JobAggregator {
  private providers: JobBoardProvider[] = [];
  private readonly config: Required<AggregatorConfig>;

  constructor(config: AggregatorConfig = {}) {
    this.config = {
      providers: config.providers ?? {},
      deduplicate: config.deduplicate ?? true,
      timeoutMs: config.timeoutMs ?? 15_000,
    };

    this.initProviders();
  }

  private initProviders(): void {
    const p = this.config.providers;

    // Free, no-auth providers (always enabled unless explicitly disabled)
    if (p.himalayas?.enabled !== false) {
      this.providers.push(new HimalayasProvider(p.himalayas));
    }
    if (p.arbeitnow?.enabled !== false) {
      this.providers.push(new ArbeitnowProvider(p.arbeitnow));
    }
    if (p.remotive?.enabled !== false) {
      this.providers.push(new RemotiveProvider(p.remotive));
    }
    if (p.remoteok?.enabled !== false) {
      this.providers.push(new RemoteOKProvider(p.remoteok));
    }

    // API-key providers (only enabled when config is provided)
    if (p.adzuna?.appId && p.adzuna?.appKey && p.adzuna?.enabled !== false) {
      this.providers.push(new AdzunaProvider(p.adzuna));
    }
    if (p.usajobs?.apiKey && p.usajobs?.userAgent && p.usajobs?.enabled !== false) {
      this.providers.push(new USAJobsProvider(p.usajobs));
    }
    if (p.jsearch?.rapidApiKey && p.jsearch?.enabled !== false) {
      this.providers.push(new JSearchProvider(p.jsearch));
    }
  }

  /** Add a custom provider at runtime. */
  addProvider(provider: JobBoardProvider): this {
    this.providers.push(provider);
    return this;
  }

  /** Return the list of active provider names. */
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  /**
   * Search all providers in parallel.
   * Individual provider failures are caught and reported in `sources`,
   * they do not throw or block results from other providers.
   */
  async search(params: SearchParams): Promise<AggregatedResult> {
    const start = Date.now();

    // Race all providers against a global timeout
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
        ),
      ]);

    const results = await Promise.allSettled(
      this.providers.map((provider) =>
        withTimeout(provider.search(params), this.config.timeoutMs),
      ),
    );

    const sources: SourceStatus[] = [];
    let allJobs: Job[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const providerName = this.providers[i].name;

      if (result.status === 'fulfilled') {
        const r = result.value;
        sources.push({
          name: providerName,
          count: r.jobs.length,
          error: r.error,
        });
        allJobs = allJobs.concat(r.jobs);
      } else {
        sources.push({
          name: providerName,
          count: 0,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
      }
    }

    // Deduplicate
    if (this.config.deduplicate) {
      allJobs = deduplicateJobs(allJobs);
    }

    // Sort: newest first
    allJobs.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());

    return {
      jobs: allJobs,
      total: allJobs.length,
      sources,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Search a single named provider.
   */
  async searchProvider(
    providerName: string,
    params: SearchParams,
  ): Promise<JobSearchResult> {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider) {
      throw new Error(
        `Provider "${providerName}" not found. Available: ${this.getProviderNames().join(', ')}`,
      );
    }
    return provider.search(params);
  }
}

// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ScoutLane -- Job Board Usage Example
// Run with: npx tsx src/jobBoards/example.ts

import { CachedAggregator, FileCache, TTL } from './index';

async function main() {
  const cache = new FileCache({
    cacheDir: '/tmp/scoutlane-job-cache',
    pruneOnStart: true,
  });

  const aggregator = new CachedAggregator({
    cache,
    ttlMs: TTL.LONG,
    staleWhileRevalidate: true,
    aggregator: {
      deduplicate: true,
      providers: {
        himalayas:  { enabled: true },
        arbeitnow:  { enabled: true },
        remotive:   { enabled: true },
        remoteok:   { enabled: true },
        ...(process.env.JSEARCH_RAPIDAPI_KEY && {
          jsearch: { rapidApiKey: process.env.JSEARCH_RAPIDAPI_KEY },
        }),
      },
    },
  });

  if (process.env.APIFY_API_TOKEN) {
    const { ApifyProvider } = await import('./providers/apify');
    aggregator.inner.addProvider(
      new ApifyProvider({ apiToken: process.env.APIFY_API_TOKEN }),
    );
  }

  console.log('Active providers:', aggregator.inner.getProviderNames().join(', '));

  const result = await aggregator.search({
    query: 'TypeScript developer',
    remote: true,
    tags: ['typescript', 'node'],
    page: 1,
    pageSize: 20,
  });

  const label = result.fromCache ? '(from cache)' : '(live fetch)';
  console.log(`\n${label} ${result.total} jobs in ${result.durationMs}ms\n`);

  for (const s of result.sources) {
    const icon = s.error ? 'x' : 'ok';
    const detail = s.error ? ` -- ${s.error}` : ` -- ${s.count} jobs`;
    console.log(`  [${icon}] ${s.name}${detail}`);
  }

  console.log('\nTop 5:');
  for (const job of result.jobs.slice(0, 5)) {
    const sal = job.salary
      ? `  $${job.salary.min?.toLocaleString()}-${job.salary.max?.toLocaleString()}`
      : '';
    console.log(`  [${job.source}] ${job.title} @ ${job.company} (${job.location})${sal}`);
  }

  const stats = aggregator.stats();
  if (stats) {
    const pct = (stats.hitRate * 100).toFixed(0);
    console.log(`\nCache -- hits: ${stats.hits}, misses: ${stats.misses}, hit rate: ${pct}%`);
  }

  // To force a refresh (e.g. from a nightly cron):
  // await aggregator.refresh({ query: 'TypeScript developer', remote: true });
}

main().catch(console.error);

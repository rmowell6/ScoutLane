// Small, dependency-free helpers for bounding fan-out as the ingest pipeline scales: a
// bounded-concurrency map and a fixed-size chunker. Kept generic and side-effect-free so they are
// trivially unit-testable and reusable by both the ATS orchestrator and the job-board aggregator.

/**
 * Map `worker` over `items` with AT MOST `limit` invocations in flight at once, resolving to the
 * results in INPUT ORDER (like Promise.all, but capped). This is the guardrail against firing every
 * configured source at once: instead of N simultaneous outbound connections from one function
 * invocation, at most `limit` run concurrently and the rest queue.
 *
 * Ordering: a fixed set of `limit` workers pull the next index off a shared counter, so results land
 * back in `items` order regardless of which finished first. Rejection semantics match Promise.all,
 * if a worker throws, the returned promise rejects; callers that must never abort on one bad item
 * (fetchSource, the aggregator's providers) already have their worker catch and return a result
 * object, so this stays all-or-nothing only for callers that want it.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  // Clamp the pool to [1, items.length]: never spin more workers than items, never zero.
  const poolSize = Math.min(Math.max(1, Math.floor(limit)), items.length)
  const runners = Array.from({ length: poolSize }, async () => {
    for (;;) {
      const i = next++ // ++ is atomic in single-threaded JS, so no two workers claim the same index
      if (i >= items.length) return
      results[i] = await worker(items[i] as T, i)
    }
  })
  await Promise.all(runners)
  return results
}

/** Split `items` into consecutive chunks of at most `size` (the last chunk may be smaller). A size
 *  of <= 0 is treated as one chunk containing everything, so a caller can never accidentally spin. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return items.length ? [[...items]] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

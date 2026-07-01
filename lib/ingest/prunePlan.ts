// Which `source` column values are safe to retire THIS run (Engineering Plan §4.1, keep the
// destructive-step policy out of the route handler and unit-testable).
//
// The retention rule is: a source may only be expired if ScoutLane actually re-observed it
// successfully this run, so its still-live rows just got `validated_at = now`. A source whose
// leg/provider failed is EXCLUDED, its live rows must never age out on a run that never saw it.
// This closes both silent-data-loss modes from the review: (a) a whole leg rejecting, and (b) a
// single provider's transient failure dropping its postings from the re-stamp set.

/** ATS rows carry `source` = provider (greenhouse|lever|ashby), but success is reported per
 *  (provider, company). A provider is prunable only if EVERY one of its sources succeeded this run
 *  (and at least one ran), one failed company makes the whole provider's rows unsafe to expire. */
export function prunableAtsProviders(sources: { provider: string; ok: boolean }[]): string[] {
  const byProvider = new Map<string, { total: number; ok: number }>()
  for (const s of sources) {
    const acc = byProvider.get(s.provider) ?? { total: 0, ok: 0 }
    acc.total += 1
    if (s.ok) acc.ok += 1
    byProvider.set(s.provider, acc)
  }
  return [...byProvider.entries()]
    .filter(([, v]) => v.total > 0 && v.ok === v.total)
    .map(([provider]) => provider)
}

/** Board rows carry `source` = the provider name (jsearch, adzuna, arbeitnow, ...), which the
 *  aggregator already reports per-provider. A board source is prunable iff it returned no error. */
export function prunableBoardSources(sources: { name: string; error?: string }[]): string[] {
  return sources.filter((s) => !s.error).map((s) => s.name)
}

// Apify ingest cadence (Engineering Plan §4.1, keep scheduling policy out of the route handler).
//
// The Apify leg (Dice + Wellfound) is metered against a $5/month free credit, Wellfound is
// $0.99/run flat and Dice ~$0.004/result, so it CANNOT run daily like the free boards: 30 daily
// runs would cost ~$30 and blow the credit. Instead it runs only on a few fixed days-of-month.
//
// Default 1/11/21 → exactly 3 runs/month (~3 × $0.99 + 3 × ~$0.40 ≈ $4.17), comfortably under the
// $5 credit with headroom. Those three days exist in every month, so the run count is a predictable
// 3, never a surprise 4th from a 31-day month. The free boards keep refreshing every day; only this
// metered leg throttles.

// Evenly spaced, present in every month (≤ 28), so the monthly run count is deterministic.
export const APIFY_DAYS_DEFAULT: readonly number[] = [1, 11, 21]

/**
 * Parse the allowed days-of-month from `APIFY_INGEST_DAYS` (comma-separated, e.g. "1,8,15,22").
 * Tunable without a code change. Invalid/out-of-range entries are dropped; an empty or absent value
 * falls back to the default. Days outside 1..31 are ignored.
 */
export function apifyDays(env: Record<string, string | undefined> = process.env): number[] {
  const raw = env.APIFY_INGEST_DAYS
  if (!raw) return [...APIFY_DAYS_DEFAULT]
  const days = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
  return days.length > 0 ? days : [...APIFY_DAYS_DEFAULT]
}

/**
 * True when the given run timestamp (ISO) falls on an allowed Apify day. UTC is used to match the
 * timestamp the cron stamps (`new Date().toISOString()`), so the day boundary is consistent
 * run-to-run regardless of server locale.
 */
export function isApifyDay(nowIso: string, env: Record<string, string | undefined> = process.env): boolean {
  return apifyDays(env).includes(new Date(nowIso).getUTCDate())
}

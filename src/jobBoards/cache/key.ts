// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Cache Key Generation
//
// Goals:
//   1. Deterministic — same logical query always produces the same key.
//   2. Normalised  — field order, casing, and whitespace are irrelevant.
//   3. Scoped      — keys are prefixed by source name so two providers with
//                    identical params don't collide.
//
// Ref: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
// ─────────────────────────────────────────────────────────────────────────────

import type { SearchParams } from '../types';

/**
 * Produce a stable, URL-safe cache key from a provider name + search params.
 *
 * Steps:
 *   1. Drop undefined/null fields.
 *   2. Sort keys alphabetically.
 *   3. Lowercase string values; sort array values.
 *   4. Stable-serialise to JSON.
 *   5. Prefix with source name.
 *
 * We intentionally avoid crypto hashing here — for a POC the readable key
 * makes debugging far easier, and the raw JSON string is short enough.
 * Swap to a SHA-256 hash if keys end up in URLs or exceed 250 chars.
 */
export function buildCacheKey(source: string, params: SearchParams): string {
  const normalised = normaliseParams(params);
  const payload = JSON.stringify(normalised);
  // Base64url is filesystem- and URL-safe
  const encoded = Buffer.from(payload).toString('base64url');
  return `${source}::${encoded}`;
}

/**
 * Build a key that covers ALL providers — used by the aggregator to cache
 * the merged result of a multi-provider search.
 */
export function buildAggregatorKey(params: SearchParams): string {
  return buildCacheKey('__agg__', params);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseParams(params: SearchParams): Record<string, unknown> {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, normaliseValue(v)])
    .sort(([a], [b]) => a.localeCompare(b));

  return Object.fromEntries(entries);
}

function normaliseValue(v: unknown): unknown {
  if (typeof v === 'string') return v.toLowerCase().trim();
  if (Array.isArray(v)) {
    return v
      .map(normaliseValue)
      .sort((a, b) => String(a).localeCompare(String(b)));
  }
  return v;
}

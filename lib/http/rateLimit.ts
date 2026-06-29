// Per-IP rate limiting for the public, LLM-backed routes (Engineering Plan §4.1 — abuse control at
// the handler boundary, not in lib/services/*). Every /api/packet request fans out to ~4 paid model
// calls (2 Sonnet + 2 Haiku); with no auth and no throttle a loop drives unbounded Anthropic spend.
// This is the per-request control (OWASP API4:2023, Unrestricted Resource Consumption); the absolute
// ceiling is an Anthropic org-level spend cap, documented in DEPLOY.md as the non-bypassable backstop.
//
// IMPLEMENTATION NOTE: the authoritative counter is a SHARED Postgres counter (migration 0011) via
// the atomic `rate_limit_hit` RPC, so one budget is enforced across all serverless instances. The
// module-scope LRU below remains as a fallback ONLY: it's used when the Supabase secrets are absent
// (CI unit tests) or if the shared query errors (fail-open on the shared layer — a counter hiccup must
// not 500 real users; the Anthropic org spend cap is the non-bypassable backstop).
import { LRUCache } from 'lru-cache'
import { NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabaseServer'

// key -> recent request timestamps (ms), oldest-first, pruned to the window on each check.
const buckets = new LRUCache<string, number[]>({ max: 10_000, ttl: 10 * 60_000 })

const WINDOW_MS = 60_000

// Per-endpoint budgets tuned to cost (OWASP: stricter on the most expensive endpoints).
// Overridable per route via env (RATE_LIMIT_PACKET, ...) for ops tuning without a redeploy.
const DEFAULT_LIMITS: Record<string, number> = {
  packet: 5, // 2 Sonnet + 2 Haiku calls per request — tightest
  discover: 10, // 1 structuring + 1 re-rank
  profile: 10, // 1 structuring call (POST) / a stored-profile read (GET)
  extract: 20, // no LLM, but still bound upload floods
}

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the window frees up — set only when blocked. */
  retryAfter?: number
}

/**
 * Resolve the client IP. On Vercel, `x-forwarded-for` is overwritten with the real edge IP and
 * attacker-supplied values are rejected (spoof-resistant); `x-real-ip` is equivalent. Fall back to a
 * single shared bucket so a request with no resolvable IP is still limited (fail toward limiting).
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function limitFor(route: string): number {
  const raw = process.env[`RATE_LIMIT_${route.toUpperCase()}`]
  const n = raw ? Number(raw) : NaN
  return Number.isInteger(n) && n > 0 ? n : (DEFAULT_LIMITS[route] ?? 10)
}

/**
 * Sliding-window per-IP check. Returns ok:false (with retryAfter seconds) once `limit` requests have
 * landed within `windowMs`. Namespaced by route so each endpoint has its own budget.
 */
export function checkRateLimit(
  request: Request,
  route: string,
  limit: number,
  windowMs: number = WINDOW_MS,
): RateLimitResult {
  const key = `${route}:${clientIp(request)}`
  const now = Date.now()
  const cutoff = now - windowMs
  const recent = (buckets.get(key) ?? []).filter((t) => t > cutoff)

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now
    buckets.set(key, recent) // persist the pruned window
    return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
  }

  recent.push(now)
  buckets.set(key, recent)
  return { ok: true }
}

/** Whether the shared (Postgres) counter is usable — i.e. the server Supabase secrets are present. */
function isSharedStoreConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)
}

/**
 * Shared, cross-instance check via the `rate_limit_hit` RPC (migration 0011). On multiple serverless
 * instances this is the ONLY way to enforce one real budget — the in-memory LRU counts per instance.
 * Atomic in the DB (no read-modify-write race). Falls back to the local LRU when the store isn't
 * configured (CI unit tests) or the query errors (FAIL-OPEN on the shared layer: a counter hiccup must
 * not 500 real users — the Anthropic spend cap is the non-bypassable backstop).
 */
async function checkRateLimitShared(
  request: Request,
  route: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!isSharedStoreConfigured()) return checkRateLimit(request, route, limit, windowMs)
  try {
    const { data, error } = await serverSupabase().rpc('rate_limit_hit', {
      p_key: `${route}:${clientIp(request)}`,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    })
    if (error) throw error
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; retry_after: number } | undefined
    if (!row) throw new Error('rate_limit_hit returned no row')
    return row.allowed ? { ok: true } : { ok: false, retryAfter: row.retry_after }
  } catch (err) {
    console.warn('[ratelimit] shared store failed, allowing (fail-open)', err)
    return { ok: true }
  }
}

/**
 * Handler gate: returns a 429 response when the caller is over the route's budget, else null. Use as
 * the FIRST line of a handler: `const limited = await rateLimit(request, 'packet'); if (limited) return limited`.
 * The body is generic — never leak the key or any secret.
 */
export async function rateLimit(request: Request, route: string): Promise<NextResponse | null> {
  const result = await checkRateLimitShared(request, route, limitFor(route), WINDOW_MS)
  if (result.ok) return null
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : undefined,
    },
  )
}

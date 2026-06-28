// Per-IP rate limiting for the public, LLM-backed routes (Engineering Plan §4.1 — abuse control at
// the handler boundary, not in lib/services/*). Every /api/packet request fans out to ~4 paid model
// calls (2 Sonnet + 2 Haiku); with no auth and no throttle a loop drives unbounded Anthropic spend.
// This is the per-request control (OWASP API4:2023, Unrestricted Resource Consumption); the absolute
// ceiling is an Anthropic org-level spend cap, documented in DEPLOY.md as the non-bypassable backstop.
//
// IMPLEMENTATION NOTE: the counter is a module-scope LRU, so it is PER serverless instance — the
// effective limit is N x (warm instances). That is a deliberate POC tradeoff: a zero-dependency
// speed bump against cost-amplification floods. A hard, cross-instance guarantee needs a shared
// store (e.g. Upstash Redis); swap the store here without touching the handlers if that's needed.
import { LRUCache } from 'lru-cache'
import { NextResponse } from 'next/server'

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

/**
 * Handler gate: returns a 429 response when the caller is over the route's budget, else null. Use as
 * the FIRST line of a handler: `const limited = rateLimit(request, 'packet'); if (limited) return limited`.
 * The body is generic — never leak the key or any secret.
 */
export function rateLimit(request: Request, route: string): NextResponse | null {
  const result = checkRateLimit(request, route, limitFor(route))
  if (result.ok) return null
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : undefined,
    },
  )
}

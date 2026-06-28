import { describe, expect, test } from 'vitest'
import { checkRateLimit, clientIp, rateLimit } from './rateLimit'

// Each test uses a UNIQUE ip so the module-scope bucket can't bleed between tests.
function req(ip: string, route = 'http://x/api/test'): Request {
  return new Request(route, { headers: { 'x-forwarded-for': ip } })
}

describe('clientIp', () => {
  test('takes the first entry of x-forwarded-for (the real client edge IP on Vercel)', () => {
    expect(clientIp(req('203.0.113.7, 10.0.0.1, 10.0.0.2'))).toBe('203.0.113.7')
  })

  test('falls back to x-real-ip, then to a shared "unknown" bucket', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.9' } }))).toBe('198.51.100.9')
    expect(clientIp(new Request('http://x'))).toBe('unknown')
  })
})

describe('checkRateLimit', () => {
  test('allows requests under the limit, blocks at it, with a retryAfter', () => {
    const ip = '10.1.0.1'
    expect(checkRateLimit(req(ip), 'unit-a', 2, 60_000).ok).toBe(true)
    expect(checkRateLimit(req(ip), 'unit-a', 2, 60_000).ok).toBe(true)
    const third = checkRateLimit(req(ip), 'unit-a', 2, 60_000)
    expect(third.ok).toBe(false)
    expect(third.retryAfter).toBeGreaterThan(0)
  })

  test('counts each IP independently', () => {
    expect(checkRateLimit(req('10.2.0.1'), 'unit-b', 1, 60_000).ok).toBe(true)
    expect(checkRateLimit(req('10.2.0.1'), 'unit-b', 1, 60_000).ok).toBe(false)
    // a different IP still has its full budget
    expect(checkRateLimit(req('10.2.0.2'), 'unit-b', 1, 60_000).ok).toBe(true)
  })

  test('counts each route independently for the same IP', () => {
    const ip = '10.3.0.1'
    expect(checkRateLimit(req(ip), 'unit-c1', 1, 60_000).ok).toBe(true)
    expect(checkRateLimit(req(ip), 'unit-c1', 1, 60_000).ok).toBe(false)
    expect(checkRateLimit(req(ip), 'unit-c2', 1, 60_000).ok).toBe(true) // separate budget
  })

  test('a zero-length window lets every request through (nothing is "recent")', () => {
    const ip = '10.4.0.1'
    expect(checkRateLimit(req(ip), 'unit-d', 1, 0).ok).toBe(true)
    expect(checkRateLimit(req(ip), 'unit-d', 1, 0).ok).toBe(true)
  })
})

describe('rateLimit (handler gate)', () => {
  test('returns null under budget and a 429 response once the default packet budget is exceeded', () => {
    const ip = '10.5.0.1'
    // default packet budget is 5/min
    for (let i = 0; i < 5; i++) expect(rateLimit(req(ip), 'packet')).toBeNull()
    const blocked = rateLimit(req(ip), 'packet')
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBeTruthy()
  })
})

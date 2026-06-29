import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  configured: true,
  inserts: [] as Array<{ email: string; note?: string; source?: string }>,
  throwOnInsert: false,
}))

vi.mock('@/lib/services/waitlistStore', () => ({
  isWaitlistConfigured: () => state.configured,
  WaitlistStoreError: class extends Error {
    constructor(
      readonly step: string,
      override readonly cause: unknown,
    ) {
      super(`waitlist store step '${step}'`)
    }
  },
  addToWaitlist: vi.fn(async (entry: { email: string; note?: string; source?: string }) => {
    if (state.throwOnInsert) throw new Error('db down')
    state.inserts.push(entry)
  }),
}))

// No Supabase env in unit tests → rateLimit uses the in-memory LRU fallback (per-instance limiter).
import { POST } from './route'

function req(body: unknown, ip = '10.9.0.1'): Request {
  return new Request('http://x/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.configured = true
  state.inserts = []
  state.throwOnInsert = false
})
afterEach(() => vi.clearAllMocks())

describe('POST /api/waitlist', () => {
  test('accepts a valid email and records it with source=landing', async () => {
    const res = await POST(req({ email: 'Person@Example.com' }, '10.9.1.1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]?.source).toBe('landing')
  })

  test('rejects a malformed email with 400', async () => {
    const res = await POST(req({ email: 'not-an-email' }, '10.9.2.1'))
    expect(res.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  test('is non-enumerating: a duplicate signup returns the same generic 200', async () => {
    // The store treats a repeat as a silent no-op; the handler can\'t tell new from existing.
    const first = await POST(req({ email: 'dup@example.com' }, '10.9.3.1'))
    const second = await POST(req({ email: 'dup@example.com' }, '10.9.3.2'))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true })
  })

  test('returns 503 when the store is not configured', async () => {
    state.configured = false
    const res = await POST(req({ email: 'a@b.com' }, '10.9.4.1'))
    expect(res.status).toBe(503)
  })

  test('429s once the per-IP budget (5/min) is exceeded', async () => {
    const ip = '10.9.5.1'
    for (let i = 0; i < 5; i++) expect((await POST(req({ email: `u${i}@x.com` }, ip))).status).toBe(200)
    const blocked = await POST(req({ email: 'u6@x.com' }, ip))
    expect(blocked.status).toBe(429)
  })
})

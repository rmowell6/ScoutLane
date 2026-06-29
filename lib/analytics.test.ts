import { afterEach, describe, expect, test, vi } from 'vitest'

const ph = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }))
vi.mock('posthog-js', () => ({ default: ph }))

import { initAnalytics, isAnalyticsEnabled, track, trackPageview, EVENTS } from './analytics'

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY
})

describe('analytics (env-gated)', () => {
  test('does nothing without NEXT_PUBLIC_POSTHOG_KEY — a complete no-op', () => {
    initAnalytics()
    expect(isAnalyticsEnabled()).toBe(false)
    // Events are silently dropped, never throwing, so call sites need no guards of their own.
    expect(() => track(EVENTS.packetGenerated, { jdMode: 'paste' })).not.toThrow()
    expect(() => trackPageview('/app')).not.toThrow()
    expect(ph.init).not.toHaveBeenCalled()
    expect(ph.capture).not.toHaveBeenCalled()
  })

  test('EVENTS covers the three Phase-0 thresholds', () => {
    expect(EVENTS).toMatchObject({
      signedIn: 'signed_in',
      packetGenerated: 'packet_generated',
      packetOpened: 'packet_opened',
      packetRated: 'packet_rated',
      wouldPay: 'would_pay',
    })
  })
})

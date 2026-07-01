// Product analytics (M4-C). A thin, ENV-GATED wrapper over posthog-js: with no
// NEXT_PUBLIC_POSTHOG_KEY set, every function here is a no-op, so the app behaves identically in
// dev/CI and until PostHog is wired. Browser-only, guarded by `typeof window` so a server component
// importing a client component that uses this never crashes.
//
// We intentionally do NOT identify users by email here: the Phase-0 thresholds are funnel RATES,
// which anonymous distinct_ids measure fine, and keeping PII out of a third party matches the
// product's privacy posture. Add posthog.identify(...) later if/when person-level analysis is needed.
import posthog from 'posthog-js'

/** Canonical event names. The three Phase-0 success thresholds map onto these:
 *  - activation (~60% generate + open):  signedIn → packetGenerated → packetOpened
 *  - quality   (~50% "I'd send this"):    packetRated
 *  - willingness to pay (~30%):           wouldPay
 */
export const EVENTS = {
  signedIn: 'signed_in',
  packetGenerated: 'packet_generated',
  packetOpened: 'packet_opened',
  packetRated: 'packet_rated',
  wouldPay: 'would_pay',
} as const

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS]

let started = false

/** Initialize PostHog once, on the client, only when a key is configured. Safe to call repeatedly. */
export function initAnalytics(): void {
  if (started || typeof window === 'undefined') return
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return // env-gated: a complete no-op until PostHog is configured
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    capture_pageview: false, // App Router: we send $pageview manually on navigation (see Providers)
    capture_pageleave: true,
  })
  started = true
}

export function isAnalyticsEnabled(): boolean {
  return started
}

/** Record a product event. No-op until analytics is initialized (i.e. unless a key is set). */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!started) return
  posthog.capture(event, props)
}

/** Record a virtual pageview for an App Router navigation. No-op until initialized. */
export function trackPageview(path: string): void {
  if (!started) return
  posthog.capture('$pageview', { $current_url: path })
}

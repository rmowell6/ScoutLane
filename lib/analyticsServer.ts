// Server-side PostHog capture, for events that originate in Node route handlers (the guardrail block
// happens server-side, so posthog-js in the browser can never see it). Three rules:
//   1. ENV-GATED: with no key set this is a complete no-op, so dev/CI and the un-configured app behave
//      exactly as before. Reuses NEXT_PUBLIC_POSTHOG_KEY (PostHog's ingest key is write-only, not a
//      secret) so setting the one client key lights this up too; POSTHOG_KEY overrides if you want a
//      separate server key.
//   2. FAIL-OPEN: a capture error is caught and logged, never thrown. Analytics must NEVER break or
//      delay packet generation.
//   3. NO new dependency and NO posthog-js import (browser-only): we POST straight to the capture
//      endpoint with fetch, which is available in the nodejs runtime this route pins.
//
// Privacy: callers pass only derived, non-PII properties (see lib/blockSignals.ts). distinct_id is the
// Supabase user id (an opaque UUID, not an email), matching the app's "no PII in a third party" posture.

/** Canonical server-side event names (kept local so this module never imports the browser analytics). */
export const SERVER_EVENTS = {
  packetBlocked: 'packet_blocked',
} as const

export type ServerAnalyticsEvent = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS]

function serverKey(): string | undefined {
  // `||`, not `??`: an env var set to an empty string ("POSTHOG_KEY=") must fall through to the client
  // key, not shadow it with a blank value that silently disables capture.
  return process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
}

function host(): string {
  const h = process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
  return h.replace(/\/+$/, '')
}

/** True when a key is configured, so server capture will actually send. */
export function serverAnalyticsEnabled(): boolean {
  return Boolean(serverKey())
}

/**
 * Record a server-side product event in PostHog. No-op unless a key is configured. Never throws and
 * never rejects: a network/ingest failure is swallowed (logged) so it can't turn a good response into
 * an error. Awaiting it is safe and guarantees delivery before a serverless function is frozen.
 */
export async function captureServer(
  event: ServerAnalyticsEvent,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const key = serverKey()
  if (!key) return
  try {
    await fetch(`${host()}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: 'scoutlane-server' },
      }),
      // Bound the request: this is awaited in the packet route, so without a timeout a slow/hung
      // PostHog endpoint would stall the user's response and could push the route past maxDuration
      // (a 504). 2s is plenty for an ingest POST; on abort we swallow below and move on.
      signal: AbortSignal.timeout(2000),
    })
  } catch (err) {
    console.error('[analytics] server capture failed (non-blocking)', err)
  }
}

// Shared cron-endpoint auth, matching app/api/jobs/ingest/route.ts (which keeps its own inline
// copy, left untouched per the integration handoff). Require `Authorization: Bearer <CRON_SECRET>`,
// compared in CONSTANT TIME. Fail CLOSED in production: if no secret is configured, the endpoint is
// unavailable rather than wide open (these routes write to the DB and call external APIs). Outside
// prod (local/preview) it stays open when no secret is set, for convenience.
import { timingSafeEqual } from 'node:crypto'

const isProd = process.env.NODE_ENV === 'production'

export type CronAuthResult = 'ok' | 'unauthorized' | 'misconfigured'

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Authorize a cron/ingest request against CRON_SECRET. */
export function authorizeCron(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET
  if (!secret) return isProd ? 'misconfigured' : 'ok'
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`) ? 'ok' : 'unauthorized'
}

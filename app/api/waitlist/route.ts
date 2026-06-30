// POST /api/waitlist — capture an access request from the public landing (M4). Open to anonymous
// visitors (no requireUser), so it's rate-limited and deliberately NON-ENUMERATING: it returns the
// same generic success whether the email is new, already waiting, or already invited, so the
// endpoint can't be used to probe who's on the list. Thin handler: validate → service → map.
import { NextResponse, after } from 'next/server'
import * as z from 'zod'
import { addToWaitlist, isWaitlistConfigured, WaitlistStoreError } from '@/lib/services/waitlistStore'
import { notifyWaitlistSignup } from '@/lib/services/notifyWaitlist'
import { rateLimit } from '@/lib/http/rateLimit'
import { serverErrorBody } from '@/lib/http/errors'

export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().trim().email().max(254),
  // Optional free-text context ("what are you hoping to use it for?"). Bounded; untrusted.
  note: z.string().trim().max(500).optional(),
})

export async function POST(request: Request) {
  try {
    // Anonymous endpoint → throttle hard before any work (abuse / signup-flood control).
    const limited = await rateLimit(request, 'waitlist')
    if (limited) return limited

    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    // If storage isn't wired (e.g. a preview without secrets), say so honestly with a 503 rather
    // than pretend-succeeding — the visitor's request would otherwise be silently dropped.
    if (!isWaitlistConfigured()) {
      return NextResponse.json(
        { error: 'Waitlist not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }

    await addToWaitlist({ email: parsed.data.email, note: parsed.data.note, source: 'landing' })

    // Notify the admin AFTER the response is sent: after() guarantees the work runs on Vercel
    // (unlike a bare fire-and-forget, which can be frozen) while keeping the signup fast.
    // notifyWaitlistSignup never throws and no-ops when SES is unconfigured, so this can't affect the
    // 200 we return — a notification failure must never fail the visitor's signup.
    after(() => notifyWaitlistSignup({ email: parsed.data.email, note: parsed.data.note, source: 'landing' }))

    // Same response for new vs. already-present — no enumeration.
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    const step = err instanceof WaitlistStoreError ? `waitlist:${err.step}` : null
    console.error('[waitlist] request failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

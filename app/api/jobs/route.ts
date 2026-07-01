// GET /api/jobs, the pool for the picker (light list, no JD bodies). Thin handler.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { JobStoreError, isJobStoreConfigured, listJobs } from '@/lib/services/jobStore'
import { serverErrorBody } from '@/lib/http/errors'
import { rateLimit } from '@/lib/http/rateLimit'
import { requireUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Validate the query at the boundary: `q` is bounded (it feeds a stored search) and `limit` is a
// positive integer capped at 100. Reject malformed input with a 400 rather than coercing silently.
const Query = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export async function GET(request: Request) {
  try {
    // Throttle + require a session: the pool is owner-scoped data, not a public listing.
    const limited = await rateLimit(request, 'jobs')
    if (limited) return limited

    const user = await requireUser()
    if (user instanceof NextResponse) return user

    if (!isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }

    const params = new URL(request.url).searchParams
    const parsed = Query.safeParse({
      q: params.get('q') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    const jobs = await listJobs(parsed.data)
    return NextResponse.json({ jobs, count: jobs.length }, { status: 200 })
  } catch (err) {
    const step = err instanceof JobStoreError ? err.step : null
    console.error('[jobs] list failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

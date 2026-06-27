// GET /api/jobs — the pool for the picker (light list, no JD bodies). Thin handler.
import { NextResponse } from 'next/server'
import { JobStoreError, isJobStoreConfigured, listJobs } from '@/lib/services/jobStore'
import { serverErrorBody } from '@/lib/http/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    if (!isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }
    const params = new URL(request.url).searchParams
    const q = params.get('q') ?? undefined
    const limitRaw = Number(params.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : undefined

    const jobs = await listJobs({ q, limit })
    return NextResponse.json({ jobs, count: jobs.length }, { status: 200 })
  } catch (err) {
    const step = err instanceof JobStoreError ? err.step : null
    console.error('[jobs] list failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

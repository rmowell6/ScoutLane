// GET /api/jobs — the pool for the picker (light list, no JD bodies). Thin handler.
import { NextResponse } from 'next/server'
import { JobStoreError, isJobStoreConfigured, listJobs } from '@/lib/services/jobStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }
    const jobs = await listJobs()
    return NextResponse.json({ jobs, count: jobs.length }, { status: 200 })
  } catch (err) {
    const step = err instanceof JobStoreError ? err.step : null
    const message = err instanceof Error ? err.message : String(err)
    console.error('[jobs] list failed', step ?? '', err)
    return NextResponse.json({ error: 'Internal Server Error', step, message }, { status: 500 })
  }
}

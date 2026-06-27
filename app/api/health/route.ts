import { NextResponse } from 'next/server'

// GET handlers are dynamic (uncached) by default in Next 16.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true })
}

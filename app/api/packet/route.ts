// POST /api/packet — the hero pipeline. Thin handler: validate -> call service -> map to HTTP
// (Engineering Plan §4.1). runtime='nodejs' is required once docgen lands (docx needs Buffer);
// pinned now so the contract is stable.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { buildPacket } from '@/lib/services/buildPacket'

export const runtime = 'nodejs'
export const maxDuration = 120 // seconds; Fluid Compute allows more, raise if needed

const Body = z.object({
  resumeText: z.string().min(1),
  jdText: z.string().min(1),
  bannedTerms: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    const packet = await buildPacket(parsed.data)

    // Never ship a failed guardrail silently — surface it for regeneration / human review.
    if (!packet.guardrails.ok) {
      return NextResponse.json(
        { error: 'Guardrail check failed', guardrails: packet.guardrails },
        { status: 422 },
      )
    }

    return NextResponse.json(packet, { status: 200 })
  } catch (err) {
    console.error('[packet] generation failed', err) // log server-side
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }) // generic to client
  }
}

// POST /api/packet — the hero pipeline. Thin handler: validate -> call service -> map to HTTP
// (Engineering Plan §4.1). runtime='nodejs' is required once docgen lands (docx needs Buffer);
// pinned now so the contract is stable.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { buildPacket, PacketError } from '@/lib/services/buildPacket'

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
    // A 422 here is NOT request validation (that's 400 above); it means the generated packet
    // failed a guardrail. Spell out exactly which check tripped and why, so it's debuggable.
    if (!packet.guardrails.ok) {
      const g = packet.guardrails
      const reasons: string[] = []
      if (!g.noFabrication.ok) {
        reasons.push(
          `no-fabrication: ${g.noFabrication.unverifiable.length} claim(s) do not trace to a profile fact: ` +
            g.noFabrication.unverifiable.map((c) => `"${c.text}"`).join('; '),
        )
      }
      if (!g.bannedTerms.ok) reasons.push(`banned-terms: ${g.bannedTerms.violations.join(', ')}`)
      if (!g.style.ok) reasons.push(`style: ${g.style.violations.join('; ')}`)
      if (g.ats && !g.ats.ok) reasons.push(`ats: ${g.ats.problems.join('; ')}`)

      console.error('[packet] guardrail blocked:', reasons.join(' | '))
      return NextResponse.json(
        { error: 'Guardrail check failed', reasons, guardrails: g },
        { status: 422 },
      )
    }

    return NextResponse.json(packet, { status: 200 })
  } catch (err) {
    // Surface which pipeline step failed + its message. Step names and error messages here
    // are diagnostics, not secrets (API keys never appear in them). Tighten before public launch.
    const step = err instanceof PacketError ? err.step : null
    const message = err instanceof Error ? err.message : String(err)
    console.error('[packet] generation failed', step ?? '', err)
    return NextResponse.json(
      { error: 'Internal Server Error', step, message },
      { status: 500 },
    )
  }
}

// POST /api/packet — the hero pipeline. Thin handler: validate -> call service -> map to HTTP
// (Engineering Plan §4.1). runtime='nodejs' is required once docgen lands (docx needs Buffer);
// pinned now so the contract is stable.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { buildPacket, PacketError } from '@/lib/services/buildPacket'
import { getProfile, ProfileStoreError } from '@/lib/services/profileStore'

export const runtime = 'nodejs'
export const maxDuration = 120 // seconds; Fluid Compute allows more, raise if needed

// Provide a resume one of two ways: paste raw text (stateless) OR reference a saved profile
// (reuse path; skips re-structuring). Exactly one is required, enforced below.
const Body = z
  .object({
    resumeText: z.string().min(1).optional(),
    profileId: z.uuid().optional(),
    jdText: z.string().min(1),
    bannedTerms: z.array(z.string()).optional(),
  })
  .refine((b) => Boolean(b.resumeText) !== Boolean(b.profileId), {
    message: 'provide exactly one of resumeText or profileId',
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

    // Reuse path: load the stored profile and hand it to the pipeline (skips structureResume).
    let profile
    if (parsed.data.profileId) {
      profile = await getProfile(parsed.data.profileId)
      if (!profile) {
        return NextResponse.json({ error: 'Profile not found', profileId: parsed.data.profileId }, { status: 404 })
      }
    }

    const packet = await buildPacket({
      jdText: parsed.data.jdText,
      resumeText: parsed.data.resumeText,
      profile,
      bannedTerms: parsed.data.bannedTerms,
    })

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
    // Surface which step failed + its message. Step names and error messages here are
    // diagnostics, not secrets (API keys never appear in them). Tighten before public launch.
    const step =
      err instanceof PacketError
        ? err.step
        : err instanceof ProfileStoreError
          ? `profile:${err.step}`
          : null
    const message = err instanceof Error ? err.message : String(err)
    console.error('[packet] generation failed', step ?? '', err)
    return NextResponse.json(
      { error: 'Internal Server Error', step, message },
      { status: 500 },
    )
  }
}

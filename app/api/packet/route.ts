// POST /api/packet — the hero pipeline. Thin handler: validate -> call service -> map to HTTP
// (Engineering Plan §4.1). runtime='nodejs' is required once docgen lands (docx needs Buffer);
// pinned now so the contract is stable.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { buildPacket, PacketError } from '@/lib/services/buildPacket'
import { getStoredProfile, ProfileStoreError } from '@/lib/services/profileStore'
import { getJobJd, JobStoreError } from '@/lib/services/jobStore'
import { CandidatePreferencesSchema, type CandidatePreferences, type Profile } from '@/lib/schemas'
import { serverErrorBody } from '@/lib/http/errors'
import { rateLimit } from '@/lib/http/rateLimit'

// Bound request size before any work: a resume is a few KB of text; these ceilings fail a
// pathological multi-MB paste fast (with a clear 400) instead of melting the LLM call downstream.
const MAX_RESUME_CHARS = 100_000
const MAX_JD_CHARS = 50_000
const MAX_BANNED_TERMS = 200
const MAX_TERM_CHARS = 200

export const runtime = 'nodejs'
export const maxDuration = 120 // seconds; Fluid Compute allows more, raise if needed

// Provide a resume one of two ways: paste raw text (stateless) OR reference a saved profile
// (reuse path; skips re-structuring). Provide the JD one of two ways: paste raw text OR reference
// a pooled job by id. Exactly one of each pair is required, enforced below.
const Body = z
  .object({
    resumeText: z.string().min(1).max(MAX_RESUME_CHARS).optional(),
    profileId: z.uuid().optional(),
    jdText: z.string().min(1).max(MAX_JD_CHARS).optional(),
    jobId: z.uuid().optional(),
    preferences: CandidatePreferencesSchema.optional(),
    bannedTerms: z.array(z.string().max(MAX_TERM_CHARS)).max(MAX_BANNED_TERMS).optional(),
  })
  .refine((b) => Boolean(b.resumeText) !== Boolean(b.profileId), {
    message: 'provide exactly one of resumeText or profileId',
  })
  .refine((b) => Boolean(b.jdText) !== Boolean(b.jobId), {
    message: 'provide exactly one of jdText or jobId',
  })

export async function POST(request: Request) {
  try {
    // Abuse control FIRST: this route fans out to ~4 paid model calls, so cap per-IP frequency
    // before any work (the Anthropic spend cap is the absolute backstop — see DEPLOY.md).
    const limited = rateLimit(request, 'packet')
    if (limited) return limited

    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    // Reuse path: load the stored profile (+ its saved preferences) and hand it to the pipeline.
    let profile: Profile | undefined
    let storedPreferences: CandidatePreferences | null = null
    if (parsed.data.profileId) {
      const stored = await getStoredProfile(parsed.data.profileId)
      if (!stored) {
        return NextResponse.json({ error: 'Profile not found', profileId: parsed.data.profileId }, { status: 404 })
      }
      profile = stored.profile
      storedPreferences = stored.preferences
    }
    // Request preferences win over the profile's saved ones; fall back to saved.
    const preferences = parsed.data.preferences ?? storedPreferences ?? undefined

    // Pooled-job path: resolve the selected job's JD text from the store.
    let jdText = parsed.data.jdText
    if (parsed.data.jobId) {
      const job = await getJobJd(parsed.data.jobId)
      if (!job) {
        return NextResponse.json({ error: 'Job not found', jobId: parsed.data.jobId }, { status: 404 })
      }
      if (!job.jdText.trim()) {
        return NextResponse.json(
          { error: 'Selected job has no description text', jobId: parsed.data.jobId },
          { status: 422 },
        )
      }
      jdText = job.jdText
    }

    const packet = await buildPacket({
      jdText: jdText as string,
      resumeText: parsed.data.resumeText,
      profile,
      preferences,
      bannedTerms: parsed.data.bannedTerms,
    })

    // Never ship a failed guardrail silently — surface it for regeneration / human review.
    // A 422 here is NOT request validation (that's 400 above); it means the generated packet
    // failed a guardrail. Spell out exactly which check tripped and why, so it's debuggable.
    if (!packet.guardrails.ok) {
      const g = packet.guardrails
      const reasons: string[] = []
      if (!g.noFabrication.ok) {
        if (g.noFabrication.unverifiable.length > 0) {
          reasons.push(
            `no-fabrication: ${g.noFabrication.unverifiable.length} claim(s) do not trace to a profile fact: ` +
              g.noFabrication.unverifiable.map((c) => `"${c.text}"`).join('; '),
          )
        }
        if (g.noFabrication.ungroundedSkills.length > 0) {
          reasons.push(
            `no-fabrication: ${g.noFabrication.ungroundedSkills.length} tailored skill(s) not in the profile: ` +
              g.noFabrication.ungroundedSkills.map((s) => `"${s}"`).join(', '),
          )
        }
        if (g.noFabrication.ungroundedMetrics.length > 0) {
          reasons.push(
            `no-fabrication: ${g.noFabrication.ungroundedMetrics.length} quantified claim(s) in the summary/cover letter not grounded in the profile: ` +
              g.noFabrication.ungroundedMetrics.map((m) => `"${m}"`).join(', '),
          )
        }
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
    // Surface which step failed (a safe identifier). The raw message is withheld in production
    // (it can carry internal detail); the step is always safe — it's a fixed name from our code.
    const step =
      err instanceof PacketError
        ? err.step
        : err instanceof ProfileStoreError
          ? `profile:${err.step}`
          : err instanceof JobStoreError
            ? `job:${err.step}`
            : null
    console.error('[packet] generation failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

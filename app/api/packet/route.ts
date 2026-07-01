// POST /api/packet, the hero pipeline. Thin handler: validate -> call service -> map to HTTP
// (Engineering Plan §4.1). runtime='nodejs' is required once docgen lands (docx needs Buffer);
// pinned now so the contract is stable.
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { buildPacket, PacketError } from '@/lib/services/buildPacket'
import { saveGeneration } from '@/lib/services/generationStore'
import { getStoredProfile, isProfileStoreConfigured, ProfileStoreError } from '@/lib/services/profileStore'
import { getJobJd, isJobStoreConfigured, JobStoreError } from '@/lib/services/jobStore'
import { CandidatePreferencesSchema, type CandidatePreferences, type Profile } from '@/lib/schemas'
import { serverErrorBody } from '@/lib/http/errors'
import { rateLimit } from '@/lib/http/rateLimit'
import { requireUser } from '@/lib/auth'
import { isTransientAnthropicError } from '@/lib/anthropic'
import { describeGuardrailFailure } from '@/lib/guardrailMessages'
import { captureServer, SERVER_EVENTS } from '@/lib/analyticsServer'
import { deriveBlockSignals } from '@/lib/blockSignals'

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
    // Optional explicit style pick (theme + font ids). Absent → the server recommends one. Ids are
    // loose strings; buildPacket falls back to the master skin if an id is unknown (never crashes).
    style: z.object({ theme: z.string().min(1).max(64), font: z.string().min(1).max(64) }).optional(),
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
    // before any work (the Anthropic spend cap is the absolute backstop, see DEPLOY.md).
    const limited = await rateLimit(request, 'packet')
    if (limited) return limited

    // Gated route: a signed-in user is required (access is invite-only).
    const user = await requireUser()
    if (user instanceof NextResponse) return user

    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    // A profileId/jobId path needs the store wired. Surface a clear 503 (service misconfigured,
    // retryable) up front rather than letting the store throw deep in the pipeline and mapping to a
    // misleading 500. The stateless paths (resumeText + jdText) don't touch the store, so skip.
    if (parsed.data.profileId && !isProfileStoreConfigured()) {
      return NextResponse.json(
        { error: 'Profile store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }
    if (parsed.data.jobId && !isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }

    // Reuse path: load the stored profile (+ its saved preferences + original source text) and hand
    // it to the pipeline. The source text grounds the shipped bullets in the no-fabrication guardrail.
    let profile: Profile | undefined
    let storedPreferences: CandidatePreferences | null = null
    let sourceResumeText: string | undefined
    if (parsed.data.profileId) {
      const stored = await getStoredProfile(parsed.data.profileId, user.id)
      if (!stored) {
        return NextResponse.json({ error: 'Profile not found', profileId: parsed.data.profileId }, { status: 404 })
      }
      profile = stored.profile
      storedPreferences = stored.preferences
      sourceResumeText = stored.sourceResume
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
      sourceResumeText,
      preferences,
      bannedTerms: parsed.data.bannedTerms,
      // An explicit pick is a user override (source 'user'); absent → the pipeline recommends one.
      style: parsed.data.style ? { ...parsed.data.style, source: 'user' } : undefined,
      // Pooled-job path: pass the id so the style classification can be cached on the job row.
      jobId: parsed.data.jobId,
    })

    // Never ship a failed guardrail silently, surface it for regeneration / human review. A 422
    // here is NOT request validation (that's 400 above); it means the generated packet failed a
    // guardrail. We return PLAIN-LANGUAGE reasons (why it failed + how to fix) for the user, plus the
    // raw guardrails object for debugging. The precise technical detail is logged server-side.
    if (!packet.guardrails.ok) {
      const friendly = describeGuardrailFailure(packet.guardrails)
      // Log COUNTS per failing check, never the offending strings: the unverifiable claims, skills,
      // and metrics are verbatim resume / cover-letter content (user PII) and must not land in logs.
      // The full guardrails object is returned to the authenticated caller for debugging instead.
      const nf = packet.guardrails.noFabrication
      console.error(
        '[packet] guardrail blocked:',
        JSON.stringify({
          noFabrication: nf.ok,
          ungroundedSkills: nf.ungroundedSkills.length,
          unverifiable: nf.unverifiable.length,
          ungroundedMetrics: nf.ungroundedMetrics.length,
          bulletsGrounded: packet.guardrails.bulletsGrounded.ungroundedMetrics.length,
          bannedTerms: packet.guardrails.bannedTerms.violations.length,
          style: packet.guardrails.style.violations.length,
          ats: packet.guardrails.ats?.problems.length ?? null,
        }),
      )
      // Emit the same block as a PostHog event with DERIVED, non-PII signals (no claim/skill text): it
      // lets us measure, in aggregate, how often a block is a true computed aggregate (looks_like_aggregate)
      // vs a genuine invention, so the eventual robust fix is driven by data. Env-gated + fail-open, so
      // it's a no-op until a key is set. Wrapped like the persistence below so a signal/capture error can
      // never turn this 422 into a 500.
      try {
        await captureServer(SERVER_EVENTS.packetBlocked, user.id, deriveBlockSignals(packet.guardrails, packet.profile))
      } catch (err) {
        console.error('[analytics] block-signal capture failed (non-blocking)', err)
      }
      // Record the blocked attempt too (status derived as 'blocked' inside saveGeneration). Same
      // strictly non-blocking pattern as the shipped path: a persistence failure must never turn this
      // 422 into a 500. This is what lets blocked-then-abandoned users be seen in the history.
      try {
        await saveGeneration({
          userId: user.id,
          profileId: parsed.data.profileId ?? null,
          jobId: parsed.data.jobId ?? null,
          packet,
        })
      } catch (err) {
        console.error('[packet] blocked-generation persistence failed (non-blocking)', err)
      }

      return NextResponse.json(
        { error: friendly.title, reasons: friendly.reasons, guardrails: packet.guardrails },
        { status: 422 },
      )
    }

    // Persist a record of the shipped packet (owner-scoped generations history). Best-effort and
    // strictly non-blocking: the packet already succeeded, so a persistence failure must not turn a
    // good response into an error. No-op when the store is unconfigured.
    try {
      await saveGeneration({
        userId: user.id,
        profileId: parsed.data.profileId ?? null,
        jobId: parsed.data.jobId ?? null,
        packet,
      })
    } catch (err) {
      console.error('[packet] generation persistence failed (non-blocking)', err)
    }

    return NextResponse.json(packet, { status: 200 })
  } catch (err) {
    // Document generation is the final pipeline step: the fit assessment + guardrails already
    // succeeded, but building/uploading the .docx files failed. Give the user a concrete, safe
    // explanation of WHY no documents came back instead of a bare "Internal Server Error".
    if (err instanceof PacketError && err.step === 'generateDocuments') {
      console.error('[packet] document generation failed', err)
      return NextResponse.json(
        {
          error: "We couldn't generate your documents",
          step: 'generateDocuments',
          message:
            'Your fit assessment was ready, but the résumé and cover-letter files failed to build. Please try again. If it keeps happening, remove unusual formatting or special characters from your resume and retry.',
        },
        { status: 500 },
      )
    }
    // Surface which step failed (a safe identifier). The raw message is withheld in production
    // (it can carry internal detail); the step is always safe, it's a fixed name from our code.
    const step =
      err instanceof PacketError
        ? err.step
        : err instanceof ProfileStoreError
          ? `profile:${err.step}`
          : err instanceof JobStoreError
            ? `job:${err.step}`
            : null
    // A transient model overload (429/529/5xx) is not a crash, return 503 + a retry hint instead
    // of a generic 500, so the user knows to try again rather than seeing "internal error".
    if (isTransientAnthropicError(err)) {
      console.warn('[packet] transient upstream error, returning 503', step ?? '')
      return NextResponse.json(
        {
          error: 'Service busy',
          step,
          message: 'The generation service is briefly busy. Please try again in a moment.',
        },
        { status: 503 },
      )
    }
    console.error('[packet] generation failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

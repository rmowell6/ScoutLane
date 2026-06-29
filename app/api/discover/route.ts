// POST /api/discover — find pool roles similar to the candidate's experience (lexical pre-filter
// → Claude re-rank). Provide a resume one of two ways: paste raw text (stateless) OR reference a
// saved profile (reuse path). Thin handler: validate → service → map to HTTP (Engineering Plan §4.1).
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { structureResume } from '@/lib/services/structureResume'
import { discoverRoles, DiscoverError } from '@/lib/services/discoverRoles'
import { getStoredProfile, ProfileStoreError } from '@/lib/services/profileStore'
import { isJobStoreConfigured, JobStoreError } from '@/lib/services/jobStore'
import { CandidatePreferencesSchema, type Profile } from '@/lib/schemas'
import { serverErrorBody } from '@/lib/http/errors'
import { rateLimit } from '@/lib/http/rateLimit'
import { requireUser } from '@/lib/auth'
import { isTransientAnthropicError } from '@/lib/anthropic'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_RESUME_CHARS = 100_000

const Body = z
  .object({
    resumeText: z.string().min(1).max(MAX_RESUME_CHARS).optional(),
    profileId: z.uuid().optional(),
    preferences: CandidatePreferencesSchema.optional(),
  })
  .refine((b) => Boolean(b.resumeText) !== Boolean(b.profileId), {
    message: 'provide exactly one of resumeText or profileId',
  })

export async function POST(request: Request) {
  try {
    // Per-IP throttle first: discovery runs a structuring call + a Claude re-rank per request.
    const limited = await rateLimit(request, 'discover')
    if (limited) return limited

    const user = await requireUser()
    if (user instanceof NextResponse) return user

    // Discovery needs the pool; surface a clear 503 if storage isn't wired rather than an empty list.
    if (!isJobStoreConfigured()) {
      return NextResponse.json(
        { error: 'Job store not configured', message: 'Supabase secret key is not set' },
        { status: 503 },
      )
    }

    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    // Resolve the profile: reuse a stored one, or structure the pasted resume on the fly.
    let profile: Profile
    let preferences = parsed.data.preferences
    if (parsed.data.profileId) {
      const stored = await getStoredProfile(parsed.data.profileId, user.id)
      if (!stored) {
        return NextResponse.json({ error: 'Profile not found', profileId: parsed.data.profileId }, { status: 404 })
      }
      profile = stored.profile
      preferences = preferences ?? stored.preferences ?? undefined
    } else {
      profile = await structureResume(parsed.data.resumeText as string)
    }

    const roles = await discoverRoles(profile, preferences)
    return NextResponse.json({ roles, count: roles.length }, { status: 200 })
  } catch (err) {
    const step =
      err instanceof DiscoverError
        ? err.step
        : err instanceof ProfileStoreError
          ? `profile:${err.step}`
          : err instanceof JobStoreError
            ? `job:${err.step}`
            : null
    // A transient model overload is not a crash — return 503 + a clear retry hint (the client
    // auto-retries once) instead of an opaque 500 "internal error".
    if (isTransientAnthropicError(err)) {
      console.warn('[discover] transient upstream error, returning 503', step ?? '')
      return NextResponse.json(
        {
          error: 'Service busy',
          step,
          message: 'The role-matching service is briefly busy. Please try again in a moment.',
        },
        { status: 503 },
      )
    }
    console.error('[discover] failed', step ?? '', err)
    return NextResponse.json(serverErrorBody(err, step), { status: 500 })
  }
}

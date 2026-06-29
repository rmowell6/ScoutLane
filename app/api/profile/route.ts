// /api/profile — persist a structured resume so it can be reused across jobs (M2).
//   POST { resumeText } -> structure once, store -> { profileId, profile }
//   GET  ?id=<uuid>     -> rehydrate a stored profile -> { profileId, profile }
// Thin handlers: validate -> service -> map to HTTP. runtime='nodejs' (Supabase + SDK).
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { structureResume } from '@/lib/services/structureResume'
import {
  ProfileStoreError,
  getStoredProfile,
  isProfileStoreConfigured,
  saveProfile,
} from '@/lib/services/profileStore'
import { CandidatePreferencesSchema } from '@/lib/schemas'
import { serverErrorBody } from '@/lib/http/errors'
import { rateLimit } from '@/lib/http/rateLimit'
import { requireUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// Bound the stored resume text (a few KB in practice); fail a pathological paste fast.
const MAX_RESUME_CHARS = 100_000

const Body = z.object({
  resumeText: z.string().min(1).max(MAX_RESUME_CHARS),
  preferences: CandidatePreferencesSchema.optional(),
})

function notConfigured() {
  // A 503 (not 500): the app is fine, the persistence backend just isn't wired.
  return NextResponse.json(
    { error: 'Profile storage not configured', message: 'Supabase secret key is not set' },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(request, 'profile')
    if (limited) return limited

    const user = await requireUser()
    if (user instanceof NextResponse) return user

    if (!isProfileStoreConfigured()) return notConfigured()

    const json = await request.json().catch(() => null)
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }

    const profile = await structureResume(parsed.data.resumeText)
    const { id } = await saveProfile(profile, parsed.data.resumeText, parsed.data.preferences, user.id)
    return NextResponse.json({ profileId: id, profile, preferences: parsed.data.preferences ?? null }, { status: 201 })
  } catch (err) {
    return mapError(err, 'create profile')
  }
}

export async function GET(request: Request) {
  try {
    // Throttle the id lookup too: until auth lands, the profile id is a BEARER CAPABILITY (whoever
    // holds the UUID can rehydrate the profile), so rate-limiting blunts brute-force enumeration.
    const limited = await rateLimit(request, 'profile')
    if (limited) return limited

    const user = await requireUser()
    if (user instanceof NextResponse) return user

    if (!isProfileStoreConfigured()) return notConfigured()

    const id = new URL(request.url).searchParams.get('id')
    if (!id || !z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid or missing id' }, { status: 400 })
    }

    const stored = await getStoredProfile(id, user.id)
    if (!stored) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    return NextResponse.json(
      { profileId: id, profile: stored.profile, preferences: stored.preferences },
      { status: 200 },
    )
  } catch (err) {
    return mapError(err, 'get profile')
  }
}

function mapError(err: unknown, context: string) {
  const step = err instanceof ProfileStoreError ? err.step : null
  console.error(`[profile] ${context} failed`, step ?? '', err)
  return NextResponse.json(serverErrorBody(err, step), { status: 500 })
}

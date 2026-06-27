// /api/profile — persist a structured resume so it can be reused across jobs (M2).
//   POST { resumeText } -> structure once, store -> { profileId, profile }
//   GET  ?id=<uuid>     -> rehydrate a stored profile -> { profileId, profile }
// Thin handlers: validate -> service -> map to HTTP. runtime='nodejs' (Supabase + SDK).
import { NextResponse } from 'next/server'
import * as z from 'zod'
import { structureResume } from '@/lib/services/structureResume'
import {
  ProfileStoreError,
  getProfile,
  isProfileStoreConfigured,
  saveProfile,
} from '@/lib/services/profileStore'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({ resumeText: z.string().min(1) })

function notConfigured() {
  // A 503 (not 500): the app is fine, the persistence backend just isn't wired.
  return NextResponse.json(
    { error: 'Profile storage not configured', message: 'Supabase secret key is not set' },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  try {
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
    const { id } = await saveProfile(profile, parsed.data.resumeText)
    return NextResponse.json({ profileId: id, profile }, { status: 201 })
  } catch (err) {
    return mapError(err, 'create profile')
  }
}

export async function GET(request: Request) {
  try {
    if (!isProfileStoreConfigured()) return notConfigured()

    const id = new URL(request.url).searchParams.get('id')
    if (!id || !z.uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid or missing id' }, { status: 400 })
    }

    const profile = await getProfile(id)
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    return NextResponse.json({ profileId: id, profile }, { status: 200 })
  } catch (err) {
    return mapError(err, 'get profile')
  }
}

function mapError(err: unknown, context: string) {
  const step = err instanceof ProfileStoreError ? err.step : null
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[profile] ${context} failed`, step ?? '', err)
  return NextResponse.json({ error: 'Internal Server Error', step, message }, { status: 500 })
}

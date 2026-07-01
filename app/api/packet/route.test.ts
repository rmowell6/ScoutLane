import { describe, expect, test, vi } from 'vitest'

// The route is auth-gated; mock requireUser to a signed-in user so these tests exercise the
// validation / doc-gen paths (auth behavior is covered separately in lib/auth.test.ts).
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', email: 'a@b.co' })) }))

// Mock buildPacket so we can drive the document-generation failure path without an LLM/network.
// PacketError is kept REAL (spread from the original) so the route's `instanceof` check matches.
const { buildPacketMock } = vi.hoisted(() => ({ buildPacketMock: vi.fn() }))
vi.mock('@/lib/services/buildPacket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/buildPacket')>()
  return { ...actual, buildPacket: buildPacketMock }
})

// Mock generation persistence so we can force it to throw and prove the route stays non-blocking.
const { saveGenerationMock } = vi.hoisted(() => ({ saveGenerationMock: vi.fn() }))
vi.mock('@/lib/services/generationStore', () => ({ saveGeneration: saveGenerationMock }))

import { PacketError } from '@/lib/services/buildPacket'
import { POST } from '@/app/api/packet/route'

// A guardrail-blocked packet: buildPacket completed, guardrails.ok is false, documents is null. Carries
// the fields the route reads on the 422 path (describeGuardrailFailure + the count-only logging).
const blockedPacket = {
  guardrails: {
    ok: false,
    noFabrication: { ok: false, unverifiable: [], ungroundedSkills: ['Kubernetes'], ungroundedMetrics: [] },
    bannedTerms: { ok: true, violations: [] },
    style: { ok: true, violations: [] },
    ats: null,
    bulletsGrounded: { ok: true, skipped: false, ungroundedMetrics: [], flagged: [] },
  },
  documents: null,
}

// Exercises the thin-handler validation path (no LLM) plus the document-generation error mapping.
describe('POST /api/packet validation', () => {
  test('rejects a non-JSON / empty body with 400', async () => {
    const req = new Request('http://localhost/api/packet', { method: 'POST', body: 'not json' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('rejects a body missing required fields with 400', async () => {
    const req = new Request('http://localhost/api/packet', {
      method: 'POST',
      body: JSON.stringify({ resumeText: 'only resume' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('Invalid request')
  })
})

describe('POST /api/packet guardrail block', () => {
  test('returns 422 with reasons AND still persists the blocked attempt, even if persistence throws', async () => {
    buildPacketMock.mockResolvedValueOnce(blockedPacket)
    saveGenerationMock.mockRejectedValueOnce(new Error('db down')) // persistence failure must not 500
    const req = new Request('http://localhost/api/packet', {
      method: 'POST',
      body: JSON.stringify({ resumeText: 'a resume', jdText: 'a job description' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422) // not turned into a 500 by the throwing saveGeneration
    const json = (await res.json()) as { error: string; reasons: string[] }
    expect(json.error).toMatch(/held this packet back|accurate/i)
    expect(json.reasons.length).toBeGreaterThan(0)
    expect(saveGenerationMock).toHaveBeenCalledTimes(1) // the blocked attempt was recorded
  })
})

describe('POST /api/packet document-generation failure', () => {
  test('maps a generateDocuments failure to a clear, user-facing message (not a bare 500)', async () => {
    buildPacketMock.mockRejectedValueOnce(new PacketError('generateDocuments', new Error('docx boom')))
    const req = new Request('http://localhost/api/packet', {
      method: 'POST',
      body: JSON.stringify({ resumeText: 'a resume', jdText: 'a job description' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; step: string; message: string }
    expect(json.step).toBe('generateDocuments')
    expect(json.error).toMatch(/couldn't generate your documents/i)
    expect(json.message).toMatch(/try again/i)
  })
})

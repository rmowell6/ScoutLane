import { describe, expect, test, vi } from 'vitest'

// Mock buildPacket so we can drive the document-generation failure path without an LLM/network.
// PacketError is kept REAL (spread from the original) so the route's `instanceof` check matches.
const { buildPacketMock } = vi.hoisted(() => ({ buildPacketMock: vi.fn() }))
vi.mock('@/lib/services/buildPacket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/buildPacket')>()
  return { ...actual, buildPacket: buildPacketMock }
})

import { PacketError } from '@/lib/services/buildPacket'
import { POST } from '@/app/api/packet/route'

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

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Packet } from './buildPacket'

// Mutable mock state for the fake Supabase client (hoisted so the vi.mock factory can see it).
const state = vi.hoisted(() => ({
  insertResult: null as { data: unknown; error: unknown } | null,
  lastInsert: null as Record<string, unknown> | null,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.lastInsert = row
        return { select: () => ({ single: async () => state.insertResult }) }
      },
    }),
  }),
}))

import { isGenerationStoreConfigured, saveGeneration } from './generationStore'

// Minimal Packet carrying only the fields saveGeneration reads.
const packet = {
  fit: { overall: 82, band: 'Strong fit', version: '1.0.0' },
  fitInput: {
    mustHaveSkills: ['azure', 'terraform'],
    preferredSkills: ['kubernetes'],
    candidateSkills: ['azure'],
    adjacentSkills: ['terraform'],
  },
  guardrails: { ok: true },
  style: { theme: 'navy_copper', font: 'cambria_calibri', source: 'default' },
  documents: {
    resume: { docx: { filename: 'Ada_Acme_Resume.docx' } },
    coverLetter: { docx: { filename: 'Ada_Acme_Cover_Letter.docx' } },
  },
} as unknown as Packet

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'secret'
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
  state.insertResult = null
  state.lastInsert = null
})

describe('isGenerationStoreConfigured', () => {
  test('false without secrets, true with them', () => {
    expect(isGenerationStoreConfigured()).toBe(false)
    configure()
    expect(isGenerationStoreConfigured()).toBe(true)
  })
})

describe('saveGeneration', () => {
  test('is a no-op (returns null) when the store is unconfigured', async () => {
    const result = await saveGeneration({ userId: 'u1', packet })
    expect(result).toBeNull()
    expect(state.lastInsert).toBeNull() // never touched the client
  })

  test('inserts an owner-stamped row and returns the new id', async () => {
    configure()
    state.insertResult = { data: { id: 'gen-1' }, error: null }
    const result = await saveGeneration({ userId: 'u1', profileId: 'p1', jobId: 'j1', packet })
    expect(result).toEqual({ id: 'gen-1' })
    expect(state.lastInsert).toMatchObject({
      user_id: 'u1',
      profile_id: 'p1',
      job_id: 'j1',
      scores: packet.fit,
      guardrail_report: packet.guardrails,
      style: packet.style,
      resume_doc_path: 'Ada_Acme_Resume.docx',
      cover_doc_path: 'Ada_Acme_Cover_Letter.docx',
    })
    expect(state.lastInsert?.keyword_coverage).toEqual({
      mustHave: ['azure', 'terraform'],
      preferred: ['kubernetes'],
      candidate: ['azure'],
      adjacent: ['terraform'],
    })
  })

  test('defaults profileId/jobId and the doc paths to null (stateless path, no documents)', async () => {
    configure()
    state.insertResult = { data: { id: 'gen-2' }, error: null }
    await saveGeneration({ userId: 'u1', packet: { ...packet, documents: null } as unknown as Packet })
    expect(state.lastInsert).toMatchObject({
      profile_id: null,
      job_id: null,
      resume_doc_path: null,
      cover_doc_path: null,
    })
  })

  test('throws on an insert error so the caller can log it (caller treats it as non-blocking)', async () => {
    configure()
    state.insertResult = { data: null, error: { message: 'boom' } }
    await expect(saveGeneration({ userId: 'u1', packet })).rejects.toBeTruthy()
  })
})

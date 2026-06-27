import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mock every network/LLM/docgen edge so buildPacket runs purely. We only care here about the
// reuse-vs-structure branch: a provided profile must skip structureResume.
const structureResume = vi.hoisted(() => vi.fn())
vi.mock('./structureResume', () => ({ structureResume }))
vi.mock('./parseJob', () => ({
  parseJob: vi.fn(async () => ({ mustHave: [], niceToHave: [] })),
}))
vi.mock('./scoreFit', () => ({
  scoreFit: vi.fn(async () => ({ overall: 70, subs: [], reasonCodes: [] })),
}))
vi.mock('./tailorResume', () => ({
  tailorResume: vi.fn(async () => ({ summary: 's', skills: [], claims: [], coverLetter: 'c' })),
}))
vi.mock('@/lib/guardrails', () => ({
  runGuardrails: () => ({
    ok: true,
    noFabrication: { ok: true, unverifiable: [] },
    bannedTerms: { ok: true, violations: [] },
    style: { ok: true, violations: [] },
    ats: null,
  }),
}))
vi.mock('@/lib/docgen/resume', () => ({ buildResumeDocx: async () => Buffer.from('r') }))
vi.mock('@/lib/docgen/coverLetter', () => ({ buildCoverLetterDocx: async () => Buffer.from('c') }))
vi.mock('@/lib/docgen/fitAssessment', () => ({ buildFitAssessmentDocx: async () => Buffer.from('f') }))
vi.mock('@/lib/docgen/mapProfile', () => ({
  toResumeContent: () => ({}),
  toCoverLetterContent: () => ({}),
  toFitAssessmentContent: () => ({}),
}))
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: () => false,
  uploadDocx: vi.fn(),
}))

import { buildPacket, PacketError } from './buildPacket'

const PROFILE: Profile = {
  name: 'Ada Lovelace',
  summary: 'Engineer.',
  skills: ['Azure'],
  roles: [],
  certs: [],
  education: [],
}

describe('buildPacket profile vs resumeText', () => {
  beforeEach(() => {
    structureResume.mockReset()
    structureResume.mockResolvedValue(PROFILE)
  })

  test('reuse path: a provided profile skips structureResume', async () => {
    const packet = await buildPacket({ profile: PROFILE, jdText: 'JD', date: 'June 27, 2026' })
    expect(structureResume).not.toHaveBeenCalled()
    expect(packet.profile).toEqual(PROFILE)
    expect(packet.documents?.storage).toBe('inline')
    // The packet now ships three documents incl. the fit assessment.
    expect(packet.documents?.fitAssessment.filename).toContain('Fit_Assessment')
    expect(packet.documents?.fitAssessment.base64).toBeTruthy()
  })

  test('stateless path: raw resumeText calls structureResume', async () => {
    await buildPacket({ resumeText: 'raw resume', jdText: 'JD', date: 'June 27, 2026' })
    expect(structureResume).toHaveBeenCalledOnce()
    expect(structureResume).toHaveBeenCalledWith('raw resume')
  })

  test('rejects when neither profile nor resumeText is provided', async () => {
    await expect(buildPacket({ jdText: 'JD' })).rejects.toBeInstanceOf(PacketError)
    expect(structureResume).not.toHaveBeenCalled()
  })
})

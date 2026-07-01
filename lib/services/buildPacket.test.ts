import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mock every network/LLM/docgen edge so buildPacket runs purely. We only care here about the
// reuse-vs-structure branch: a provided profile must skip structureResume.
const structureResume = vi.hoisted(() => vi.fn())
vi.mock('./structureResume', () => ({ structureResume }))
vi.mock('./parseJob', () => ({
  parseJob: vi.fn(async () => ({ mustHave: [], niceToHave: [] })),
}))
// Fit is now extract (mocked) -> deterministic assessFit (runs for real on the FitInput below).
vi.mock('./extractFitInput', () => ({
  extractFitInput: vi.fn(async () => ({
    roleTypeMatch: 'solid',
    mustHaveSkills: ['azure'],
    candidateSkills: ['azure'],
    adjacentSkills: [],
    seniorityMatch: 'adjacent',
    compTopUsd: null,
    targetCompTopUsd: 1,
    employerType: 'direct',
    location: 'remote_us',
    locationFlags: { onCall: false, travelModerate: false, travelHeavy: false },
    vertical: 'match',
    requiredCerts: [],
    heldCerts: [],
    adjacentCerts: [],
    hardGaps: [],
    flags: { expired: false, unconfirmedLive: false, defenseAdjacent: false, heavyTravelOrPresales: false },
    lanesSurfaced: 1,
  })),
}))
vi.mock('./tailorResume', () => ({
  tailorResume: vi.fn(async () => ({ summary: 's', skills: [], claims: [], coverLetter: 'c', outreach: { linkedin: 'hi', email: 'hello' } })),
}))
// Style recommendation is mocked: buildPacket calls it only when the caller didn't pick a style.
const recommendStyle = vi.hoisted(() =>
  vi.fn(async () => ({
    style: { theme: 'forest_stone', font: 'georgia_verdana', source: 'recommended' },
    why: 'because',
  })),
)
vi.mock('./recommendStyle', () => ({ recommendStyle }))
vi.mock('@/lib/guardrails', () => ({
  runGuardrails: () => ({
    ok: true,
    noFabrication: { ok: true, unverifiable: [] },
    bannedTerms: { ok: true, violations: [] },
    style: { ok: true, violations: [] },
    ats: null,
  }),
}))
// Captured so we can assert the resolved Theme/FontPair get threaded to the builders.
const buildResumeDocx = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => Buffer.from('r')))
vi.mock('@/lib/docgen/resume', () => ({ buildResumeDocx }))
vi.mock('@/lib/docgen/coverLetter', () => ({ buildCoverLetterDocx: async () => Buffer.from('c') }))
vi.mock('@/lib/docgen/fitAssessment', () => ({ buildFitAssessmentDocx: async () => Buffer.from('f') }))
vi.mock('@/lib/docgen/pdf', () => ({
  buildResumePdf: async () => Buffer.from('rp'),
  buildCoverLetterPdf: async () => Buffer.from('cp'),
  buildFitAssessmentPdf: async () => Buffer.from('fp'),
}))
vi.mock('@/lib/docgen/mapProfile', () => ({
  toResumeContent: () => ({}),
  toCoverLetterContent: () => ({}),
  toFitAssessmentContent: () => ({}),
}))
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: () => false,
  uploadDoc: vi.fn(),
  FORMAT_META: {
    docx: { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    pdf: { ext: 'pdf', contentType: 'application/pdf' },
  },
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
    // Fit is the deterministic engine's FitResult, and the packet ships three documents.
    expect(packet.fit.band).toBeTypeOf('string')
    expect(packet.fit.dimensions).toHaveLength(8)
    // Each document ships in both formats, named <Candidate>_<DocType>.<ext> (no company here).
    const fit = packet.documents?.fitAssessment
    expect(fit?.pdf.filename).toBe('Ada_Lovelace_Fit_Assessment.pdf')
    expect(fit?.pdf.mime).toBe('application/pdf')
    expect(fit?.docx.filename).toBe('Ada_Lovelace_Fit_Assessment.docx')
    expect(packet.documents?.resume.pdf.filename).toBe('Ada_Lovelace_Resume.pdf')
    expect(packet.documents?.coverLetter.docx.filename).toBe('Ada_Lovelace_Cover_Letter.docx')
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

describe('buildPacket style threading', () => {
  // The resolved Theme/FontPair are args 2 and 3 of buildResumeDocx(content, theme, font).
  function styleOf(call: unknown[] | undefined): { theme: string; font: string } {
    const theme = call?.[1] as { id: string } | undefined
    const font = call?.[2] as { id: string } | undefined
    return { theme: theme?.id ?? '', font: font?.id ?? '' }
  }

  beforeEach(() => {
    buildResumeDocx.mockClear()
    recommendStyle.mockClear()
  })

  test('absent style → the recommendation is threaded to the builders + returned', async () => {
    const packet = await buildPacket({ profile: PROFILE, jdText: 'JD', date: 'x' })
    expect(recommendStyle).toHaveBeenCalledOnce()
    expect(styleOf(buildResumeDocx.mock.calls[0])).toEqual({ theme: 'forest_stone', font: 'georgia_verdana' })
    expect(packet.style).toEqual({ theme: 'forest_stone', font: 'georgia_verdana', source: 'recommended' })
    expect(packet.styleWhy).toBe('because')
  })

  test('explicit style wins and skips the recommender', async () => {
    const packet = await buildPacket({
      profile: PROFILE,
      jdText: 'JD',
      date: 'x',
      style: { theme: 'ink_teal', font: 'tahoma_tahoma', source: 'user' },
    })
    expect(recommendStyle).not.toHaveBeenCalled()
    expect(styleOf(buildResumeDocx.mock.calls[0])).toEqual({ theme: 'ink_teal', font: 'tahoma_tahoma' })
    expect(packet.style.source).toBe('user')
    expect(packet.styleWhy).toBeUndefined()
  })

  test('unknown style ids fall back to the master skin (never crash)', async () => {
    await buildPacket({
      profile: PROFILE,
      jdText: 'JD',
      date: 'x',
      style: { theme: 'does_not_exist', font: 'does_not_exist', source: 'user' },
    })
    expect(styleOf(buildResumeDocx.mock.calls[0])).toEqual({ theme: 'navy_copper', font: 'cambria_calibri' })
  })
})

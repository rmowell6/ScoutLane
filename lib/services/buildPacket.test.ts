import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mock every network/LLM/docgen edge so buildPacket runs purely. We only care here about the
// reuse-vs-structure branch: a provided profile must skip structureResume.
const structureResume = vi.hoisted(() => vi.fn())
vi.mock('./structureResume', () => ({ structureResume }))
// Hoisted so the parallelism tests can attach a delayed/tracking implementation; default unchanged.
const parseJob = vi.hoisted(() => vi.fn(async () => ({ mustHave: [], niceToHave: [] })))
vi.mock('./parseJob', () => ({ parseJob }))
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
// buildResumePdf is hoisted (like buildResumeDocx) so a test can prove pdf+docx build concurrently.
const buildResumePdf = vi.hoisted(() => vi.fn(async () => Buffer.from('rp')))
vi.mock('@/lib/docgen/pdf', () => ({
  buildResumePdf,
  buildCoverLetterPdf: async () => Buffer.from('cp'),
  buildFitAssessmentPdf: async () => Buffer.from('fp'),
}))
vi.mock('@/lib/docgen/mapProfile', () => ({
  toResumeContent: () => ({}),
  toCoverLetterContent: () => ({}),
  toFitAssessmentContent: () => ({}),
}))
// isStorageConfigured/uploadDoc are hoisted so the upload-parallelism and fallback tests can flip the
// store on and drive uploadDoc. Default stays "unconfigured" so the existing tests use the inline path.
const isStorageConfigured = vi.hoisted(() => vi.fn(() => false))
const uploadDoc = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ signedUrl: 'https://signed' })))
vi.mock('@/lib/storage', () => ({
  isStorageConfigured,
  uploadDoc,
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

// These prove the three Tier-1 fixes actually run their independent steps concurrently, not just that
// the output is unchanged. Each tracked mock records a `start` then, after a real (tiny) delay, an
// `end`. Two operations overlapped iff BOTH started before EITHER finished: max(startIdx) <
// min(endIdx). The buggy serial code would log start,end,start,end, so max(start) > min(end) and the
// assertion fails. Ordering (not exact ms) is what we assert, so this stays deterministic in CI.
describe('buildPacket parallelism', () => {
  function tracked<T>(events: string[], name: string, value: T): () => Promise<T> {
    return async () => {
      events.push(`${name}:start`)
      await new Promise((r) => setTimeout(r, 5))
      events.push(`${name}:end`)
      return value
    }
  }

  function overlapped(events: string[], a: string, b: string): boolean {
    const lastStart = Math.max(events.indexOf(`${a}:start`), events.indexOf(`${b}:start`))
    const firstEnd = Math.min(events.indexOf(`${a}:end`), events.indexOf(`${b}:end`))
    return lastStart >= 0 && firstEnd >= 0 && lastStart < firstEnd
  }

  beforeEach(() => {
    structureResume.mockReset()
    structureResume.mockResolvedValue(PROFILE)
    parseJob.mockReset()
    parseJob.mockResolvedValue({ mustHave: [], niceToHave: [] })
    buildResumePdf.mockReset()
    buildResumePdf.mockResolvedValue(Buffer.from('rp'))
    buildResumeDocx.mockReset()
    buildResumeDocx.mockResolvedValue(Buffer.from('r'))
    uploadDoc.mockReset()
    uploadDoc.mockResolvedValue({ signedUrl: 'https://signed' })
    isStorageConfigured.mockReturnValue(false)
  })

  test('FIX 1: a document builds its PDF and DOCX concurrently, not one then the other', async () => {
    const events: string[] = []
    buildResumePdf.mockImplementation(tracked(events, 'resume:pdf', Buffer.from('rp')))
    buildResumeDocx.mockImplementation(tracked(events, 'resume:docx', Buffer.from('r')))
    await buildPacket({ profile: PROFILE, jdText: 'JD', date: 'x' })
    expect(overlapped(events, 'resume:pdf', 'resume:docx')).toBe(true)
  })

  test('FIX 2: a document uploads its two formats concurrently', async () => {
    isStorageConfigured.mockReturnValue(true)
    const events: string[] = []
    uploadDoc.mockImplementation(async (...args: unknown[]) => {
      const format = args[1] as string
      const prefix = args[2] as string
      events.push(`${prefix}:${format}:start`)
      await new Promise((r) => setTimeout(r, 5))
      events.push(`${prefix}:${format}:end`)
      return { signedUrl: `https://signed/${prefix}/${format}` }
    })
    const packet = await buildPacket({ profile: PROFILE, jdText: 'JD', date: 'x' })
    expect(packet.documents?.storage).toBe('supabase')
    // The resume document's pdf + docx uploads (prefix 'resumes') overlapped.
    expect(overlapped(events, 'resumes:pdf', 'resumes:docx')).toBe(true)
  })

  test('FIX 2: a partial upload failure still falls back to inline delivery (unchanged behavior)', async () => {
    isStorageConfigured.mockReturnValue(true)
    // One of the parallel uploads throws; the outer try/catch must still ship every doc inline.
    uploadDoc.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as string) === 'docx') throw new Error('upload boom')
      return { signedUrl: 'https://signed' }
    })
    const packet = await buildPacket({ profile: PROFILE, jdText: 'JD', date: 'x' })
    expect(packet.documents?.storage).toBe('inline')
    expect(packet.documents?.resume.pdf.base64).toBeTypeOf('string')
    expect(packet.documents?.resume.docx.base64).toBeTypeOf('string')
    expect(packet.documents?.resume.pdf.signedUrl).toBeUndefined()
  })

  test('FIX 3: structureResume and parseJob run concurrently on the stateless path', async () => {
    const events: string[] = []
    structureResume.mockImplementation(tracked(events, 'structure', PROFILE))
    parseJob.mockImplementation(tracked(events, 'parse', { mustHave: [], niceToHave: [] }))
    await buildPacket({ resumeText: 'raw resume', jdText: 'JD', date: 'x' })
    expect(overlapped(events, 'structure', 'parse')).toBe(true)
  })

  test('FIX 3: a parseJob failure still surfaces as PacketError step "parseJob"', async () => {
    parseJob.mockRejectedValueOnce(new Error('bad jd'))
    await expect(buildPacket({ profile: PROFILE, jdText: 'JD' })).rejects.toMatchObject({
      name: 'PacketError',
      step: 'parseJob',
    })
  })

  test('FIX 3: a structureResume failure still surfaces as PacketError step "structureResume"', async () => {
    structureResume.mockRejectedValueOnce(new Error('bad resume'))
    await expect(buildPacket({ resumeText: 'raw resume', jdText: 'JD' })).rejects.toMatchObject({
      name: 'PacketError',
      step: 'structureResume',
    })
  })
})

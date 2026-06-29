import { describe, expect, test } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import {
  ExtractError,
  MAX_RESUME_BYTES,
  MAX_RESUME_CHARS,
  detectKind,
  extractResumeText,
} from './extractResumeText'

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('detectKind', () => {
  test('maps by extension', () => {
    expect(detectKind('resume.pdf', '')).toBe('pdf')
    expect(detectKind('resume.docx', '')).toBe('docx')
    expect(detectKind('resume.txt', '')).toBe('txt')
  })

  test('falls back to MIME type when extension is unknown', () => {
    expect(detectKind('resume', 'application/pdf')).toBe('pdf')
    expect(detectKind('resume', 'text/plain')).toBe('txt')
  })

  test('returns null for unsupported types (e.g. legacy .doc)', () => {
    expect(detectKind('resume.doc', 'application/msword')).toBeNull()
    expect(detectKind('photo.png', 'image/png')).toBeNull()
  })
})

describe('extractResumeText', () => {
  test('extracts plain text from a .txt upload', async () => {
    const result = await extractResumeText({
      filename: 'r.txt',
      mimeType: 'text/plain',
      bytes: bytesOf('Jordan Rivera\nCloud Engineer'),
    })
    expect(result.kind).toBe('txt')
    expect(result.text).toBe('Jordan Rivera\nCloud Engineer')
  })

  test('extracts text from a real .docx (round-trip via docx + mammoth)', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun('Ada Lovelace')] }),
            new Paragraph({ children: [new TextRun('Skills: Azure, VMware')] }),
          ],
        },
      ],
    })
    const buf = await Packer.toBuffer(doc)
    const result = await extractResumeText({
      filename: 'ada.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: new Uint8Array(buf),
    })
    expect(result.kind).toBe('docx')
    expect(result.text).toContain('Ada Lovelace')
    expect(result.text).toContain('Azure, VMware')
  })

  test('collapses whitespace artifacts but keeps paragraph breaks', async () => {
    const result = await extractResumeText({
      filename: 'r.txt',
      mimeType: 'text/plain',
      bytes: bytesOf('Line   one\t\there.\n\n\n\nLine two.'),
    })
    expect(result.text).toBe('Line one here.\n\nLine two.')
  })

  test('rejects an empty file with RangeError', async () => {
    await expect(
      extractResumeText({ filename: 'r.txt', mimeType: 'text/plain', bytes: new Uint8Array(0) }),
    ).rejects.toBeInstanceOf(RangeError)
  })

  test('rejects an over-size file with RangeError', async () => {
    await expect(
      extractResumeText({
        filename: 'r.txt',
        mimeType: 'text/plain',
        bytes: new Uint8Array(MAX_RESUME_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(RangeError)
  })

  test('rejects an unsupported type with ExtractError(detect-kind)', async () => {
    await expect(
      extractResumeText({ filename: 'r.doc', mimeType: 'application/msword', bytes: bytesOf('x') }),
    ).rejects.toMatchObject({ name: 'ExtractError', step: 'detect-kind' })
  })

  test('rejects a whitespace-only file with ExtractError(empty-text)', async () => {
    await expect(
      extractResumeText({ filename: 'r.txt', mimeType: 'text/plain', bytes: bytesOf('   \n\n  \t ') }),
    ).rejects.toMatchObject({ name: 'ExtractError', step: 'empty-text' })
  })

  test('ExtractError carries the failing step', () => {
    const e = new ExtractError('parse-pdf', new Error('boom'))
    expect(e.step).toBe('parse-pdf')
    expect(e.message).toContain('parse-pdf')
  })

  test('rejects a file whose content does not match the claimed kind (B1-6 magic bytes)', async () => {
    // Plain text bytes claiming to be a PDF: no %PDF signature → rejected before the parser runs.
    await expect(
      extractResumeText({ filename: 'fake.pdf', mimeType: 'application/pdf', bytes: bytesOf('not a real pdf') }),
    ).rejects.toMatchObject({ name: 'ExtractError', step: 'verify-magic' })
  })

  test('rejects a non-zip claiming to be .docx (B1-6 magic bytes)', async () => {
    await expect(
      extractResumeText({
        filename: 'fake.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: bytesOf('PKnope not really a zip'),
      }),
    ).rejects.toMatchObject({ name: 'ExtractError', step: 'verify-magic' })
  })

  test('txt has no signature, so any decodable bytes are accepted', async () => {
    const result = await extractResumeText({
      filename: 'r.txt',
      mimeType: 'text/plain',
      bytes: bytesOf('plain resume text'),
    })
    expect(result.kind).toBe('txt')
  })

  test('caps extracted text at MAX_RESUME_CHARS (B1-5 decompression-bomb bound)', async () => {
    const huge = 'a '.repeat(MAX_RESUME_CHARS) // ~2× the cap once expanded
    const result = await extractResumeText({
      filename: 'big.txt',
      mimeType: 'text/plain',
      bytes: bytesOf(huge),
    })
    expect(result.text.length).toBeLessThanOrEqual(MAX_RESUME_CHARS)
  })
})

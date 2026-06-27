import { describe, expect, test } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import {
  ExtractError,
  MAX_RESUME_BYTES,
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
      bytes: bytesOf('Ryan Mowell\nCloud Engineer'),
    })
    expect(result.kind).toBe('txt')
    expect(result.text).toBe('Ryan Mowell\nCloud Engineer')
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
})

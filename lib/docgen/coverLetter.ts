// Cover-letter builder, faithful port of the cover-letter generator (the master generator).
// Shares the LOCKED resume design tokens so the resume and cover letter look cohesive, now
// parameterized by a Theme + FontPair (same axes as the resume) so a packet is visually uniform.
// Single-column, ATS-safe, dark text on light. assertNoEmDash throws so an em dash can never
// ship (the SPEC style rule, enforced in code). Runs only under runtime='nodejs'.
//
// Color tokens: NAVY→primary, INK→fixed '1A1A1A', SLATE→slate, WASH→wash. The copper accent splits
// by use: GRAPHICS (rules, • separators) use theme.accent; accent-colored TEXT (the tagline) uses
// theme.accentText (≥ 4.5:1 on white). Fonts: SERIF→font.head, SANS→font.body.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type IParagraphOptions,
} from 'docx'
import type { Theme, FontPair } from '@/lib/style/types'

export interface CoverLetterCandidate {
  name: string
  tagline: string
  location: string
  phone: string
  email: string
}

export interface CoverLetterContent {
  candidate: CoverLetterCandidate
  date: string
  recipient: string
  reLine: string
  salutation: string
  paragraphs: string[]
  closing: string
  signature: string
}

/** Standing rule: no em dashes in any prose, throw so it can never ship (SPEC). */
function assertNoEmDash(content: CoverLetterContent): void {
  const fields = [content.recipient, content.reLine, content.salutation, content.closing, ...content.paragraphs]
  const offender = fields.find((t) => typeof t === 'string' && t.includes('—'))
  if (offender) {
    throw new Error('Em dash found in cover-letter prose (violates the SPEC). Offending text: ' + offender)
  }
}

export async function buildCoverLetterDocx(
  content: CoverLetterContent,
  theme: Theme,
  font: FontPair,
): Promise<Buffer> {
  assertNoEmDash(content)

  const SERIF = font.head
  const SANS = font.body
  const NAVY = theme.primary
  const ACCENT = theme.accent // GRAPHIC accent: rules, • separators
  const ACCENT_TEXT = theme.accentText // accent-colored TEXT: the tagline
  const INK = '1A1A1A'
  const SLATE = theme.slate
  const WASH = theme.wash

  const head = (
    children: TextRun[],
    o: { before?: number; after?: number; line?: number; border?: IParagraphOptions['border'] } = {},
  ) =>
    new Paragraph({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
      spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 240 },
      alignment: AlignmentType.CENTER,
      border: o.border,
      children,
    })

  const body = (text: string, o: { before?: number; after?: number } = {}) =>
    new Paragraph({
      spacing: { before: o.before ?? 0, after: o.after ?? 160, line: 288 },
      children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
    })

  const meta = (text: string) =>
    new Paragraph({
      spacing: { before: 0, after: 40, line: 264 },
      children: [new TextRun({ text, font: SANS, size: 21, color: SLATE })],
    })

  const buildHeader = (c: CoverLetterCandidate): Paragraph[] => [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: ACCENT, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),
    head([new TextRun({ text: '', font: SANS, size: 10 })], { line: 130 }),
    // Uppercased here so mixed-case input renders like the locked design (resume matches).
    head([new TextRun({ text: c.name.toUpperCase(), font: SERIF, bold: true, size: 46, color: NAVY, characterSpacing: 80 })], { line: 480 }),
    head([new TextRun({ text: c.tagline.toUpperCase(), font: SANS, bold: true, size: 20, color: ACCENT_TEXT, characterSpacing: 42 })], { before: 24, line: 230 }),
    head(
      [
        new TextRun({ text: c.location, font: SANS, size: 18, color: INK }),
        new TextRun({ text: '       •       ', font: SANS, size: 18, color: ACCENT }),
        new TextRun({ text: c.phone, font: SANS, size: 18, color: INK }),
        new TextRun({ text: '       •       ', font: SANS, size: 18, color: ACCENT }),
        new TextRun({ text: c.email, font: SANS, size: 18, color: INK }),
      ],
      { before: 70, line: 240 },
    ),
    head([new TextRun({ text: '', font: SANS, size: 10 })], {
      line: 130,
      after: 0,
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: NAVY, space: 0 } },
    }),
  ]

  const lastIdx = content.paragraphs.length - 1

  const doc = new Document({
    creator: content.signature,
    title: `${content.signature} Cover Letter`,
    styles: { default: { document: { run: { font: SANS, size: 21, color: INK } } } },
    sections: [
      {
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 0, right: 1180, bottom: 900, left: 1180 } } },
        children: [
          ...buildHeader(content.candidate),
          new Paragraph({ spacing: { before: 240, after: 0 } }),
          meta(content.date),
          ...(content.recipient ? [meta(content.recipient)] : []),
          ...(content.reLine ? [meta(content.reLine)] : []),
          new Paragraph({ spacing: { before: 120, after: 160 }, children: [new TextRun({ text: content.salutation, font: SANS, size: 21, color: INK })] }),
          ...content.paragraphs.map((p, i) => body(p, i === lastIdx ? { after: 200 } : {})),
          new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun({ text: content.closing, font: SANS, size: 21, color: INK })] }),
          new Paragraph({ spacing: { before: 60, after: 0 }, children: [new TextRun({ text: content.signature, font: SERIF, bold: true, size: 24, color: NAVY })] }),
        ],
      },
    ],
  })

  return Packer.toBuffer(doc)
}

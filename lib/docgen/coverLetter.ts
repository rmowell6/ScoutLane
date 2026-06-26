// Cover-letter builder. No existing builder was provided, so this is clean-room — but it
// reuses the LOCKED resume design tokens (Ryan_Resume_Template_SPEC.md) so the packet reads as
// one system: dark text on light, navy + copper accents, Cambria/Calibri, single column,
// ATS-safe. Runs only under runtime='nodejs' (Packer.toBuffer needs Node Buffer).
import { BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx'
import type { ContactInfo } from '@/lib/docgen/resume'

const SERIF = 'Cambria'
const SANS = 'Calibri'
const NAVY = '16335B'
const COPPER = 'B0682C'
const INK = '1A1A1A'
const SLATE = '55606E'

export interface CoverLetterContent {
  name: string
  tagline: string
  contact: ContactInfo
  /** e.g. "June 26, 2026" — passed in (Date.now is intentionally avoided in builders). */
  date: string
  greeting: string // e.g. "Dear Hiring Team,"
  /** Body split into paragraphs; each becomes its own block. No em dashes (style rule). */
  body: string[]
  closing: string // e.g. "Sincerely,"
}

const bodyParagraph = (text: string) =>
  new Paragraph({
    spacing: { before: 0, after: 160, line: 288 },
    children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
  })

export async function buildCoverLetterDocx(content: CoverLetterContent): Promise<Buffer> {
  const children: Paragraph[] = [
    // top copper rule
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: COPPER, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),
    // name + role
    new Paragraph({
      spacing: { before: 160, after: 0 },
      children: [new TextRun({ text: content.name, font: SERIF, bold: true, size: 36, color: NAVY, characterSpacing: 40 })],
    }),
    new Paragraph({
      spacing: { before: 20, after: 0 },
      children: [new TextRun({ text: content.tagline.toUpperCase(), font: SANS, bold: true, size: 20, color: COPPER, characterSpacing: 50 })],
    }),
    // contact line
    new Paragraph({
      spacing: { before: 20, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 8 } },
      children: [
        new TextRun({ text: content.contact.location, font: SANS, size: 19, color: SLATE }),
        new TextRun({ text: '   •   ', font: SANS, size: 19, color: COPPER }),
        new TextRun({ text: content.contact.phone, font: SANS, size: 19, color: SLATE }),
        new TextRun({ text: '   •   ', font: SANS, size: 19, color: COPPER }),
        new TextRun({ text: content.contact.email, font: SANS, size: 19, color: SLATE }),
      ],
    }),
    // date
    new Paragraph({
      spacing: { before: 160, after: 160 },
      children: [new TextRun({ text: content.date, font: SANS, size: 21, color: SLATE })],
    }),
    // greeting
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: content.greeting, font: SANS, size: 21, color: INK })],
    }),
    // body
    ...content.body.map(bodyParagraph),
    // closing + signature
    new Paragraph({
      spacing: { before: 80, after: 0 },
      children: [new TextRun({ text: content.closing, font: SANS, size: 21, color: INK })],
    }),
    new Paragraph({
      spacing: { before: 40, after: 0 },
      children: [new TextRun({ text: content.name, font: SERIF, bold: true, size: 24, color: NAVY })],
    }),
  ]

  const doc = new Document({
    creator: content.name,
    title: `${content.name} — ${content.tagline} Cover Letter`,
    styles: { default: { document: { run: { font: SANS, size: 21, color: INK } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 760, right: 1180, bottom: 760, left: 1180 },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}

// ATS-safe Fit Assessment builder — the third packet document (a fit assessment, alongside the
// tailored resume and cover letter). Same locked design tokens as resume.ts (dark text on light;
// structure from type scale + copper accent + border rules). Single column, no tables/images, real
// selectable text. Runs only under runtime='nodejs' (Packer.toBuffer needs Node Buffer).
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from 'docx'

const SERIF = 'Cambria'
const SANS = 'Calibri'
const NAVY = '16335B'
const COPPER = 'B0682C'
const INK = '1A1A1A'
const SLATE = '55606E'
const WASH = 'EAEEF4'

export interface FitDimension {
  label: string
  score: number
  note: string
}

export interface FitAssessmentContent {
  candidateName: string
  roleTitle: string
  company: string
  date: string
  overall: number
  band: string
  recommendation: string
  dimensions: FitDimension[]
  reasonCodes: string[]
}

const headLine = (children: TextRun[], opts: { before?: number; after?: number; line?: number } = {}) =>
  new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
    spacing: { before: opts.before ?? 0, after: opts.after ?? 0, line: opts.line ?? 240 },
    alignment: AlignmentType.CENTER,
    children,
  })

const sectionHeader = (text: string) =>
  new Paragraph({
    spacing: { before: 240, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: NAVY, space: 6 } },
    children: [
      new TextRun({ text: '■  ', font: SANS, size: 22, color: COPPER }),
      new TextRun({ text: text.toUpperCase(), font: SERIF, bold: true, size: 26, color: NAVY, characterSpacing: 44 }),
    ],
  })

const dimensionLine = (d: FitDimension) =>
  new Paragraph({
    spacing: { before: 60, after: 60, line: 268 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9420 }],
    children: [
      new TextRun({ text: d.label, font: SANS, bold: true, size: 21, color: NAVY }),
      new TextRun({ text: `\t${d.score} / 100`, font: SANS, bold: true, size: 21, color: COPPER }),
      ...(d.note
        ? [new TextRun({ text: `\n${d.note}`, font: SANS, size: 20, color: SLATE })]
        : []),
    ],
  })

const reasonItem = (text: string) =>
  new Paragraph({
    numbering: { reference: 'fb', level: 0 },
    spacing: { before: 16, after: 16, line: 264 },
    children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
  })

export async function buildFitAssessmentDocx(content: FitAssessmentContent): Promise<Buffer> {
  const subtitleBits = [content.roleTitle, content.company].filter(Boolean).join('  ·  ')

  const children: Paragraph[] = [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: COPPER, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),
    headLine([new TextRun({ text: content.candidateName.toUpperCase(), font: SERIF, bold: true, size: 46, color: NAVY, characterSpacing: 70 })], { before: 60, line: 480 }),
    headLine([new TextRun({ text: 'FIT ASSESSMENT', font: SANS, bold: true, size: 22, color: COPPER, characterSpacing: 66 })], { before: 20, line: 250 }),
    ...(subtitleBits
      ? [headLine([new TextRun({ text: subtitleBits, font: SANS, size: 20, color: SLATE, characterSpacing: 16 })], { before: 12, line: 235 })]
      : []),
    headLine([new TextRun({ text: content.date, font: SANS, size: 18, color: INK })], { before: 60, after: 0, line: 250 }),
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: NAVY, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),

    sectionHeader('Overall'),
    new Paragraph({
      spacing: { before: 80, after: 40 },
      children: [
        new TextRun({ text: `${content.overall} / 100`, font: SERIF, bold: true, size: 40, color: NAVY }),
        new TextRun({ text: `    ${content.band}`, font: SANS, bold: true, size: 24, color: COPPER }),
      ],
    }),
    new Paragraph({
      spacing: { before: 20, after: 50, line: 284 },
      children: [new TextRun({ text: content.recommendation, font: SANS, size: 21, color: INK })],
    }),

    sectionHeader('Assessment by dimension'),
    ...content.dimensions.map(dimensionLine),
  ]

  if (content.reasonCodes.length > 0) {
    children.push(sectionHeader('Signals'), ...content.reasonCodes.map(reasonItem))
  }

  children.push(
    new Paragraph({
      spacing: { before: 200, after: 0 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'This assessment is a decision aid generated from your structured history. It is not submitted to the employer.',
          font: SANS,
          italics: true,
          size: 18,
          color: SLATE,
        }),
      ],
    }),
  )

  const doc = new Document({
    creator: content.candidateName,
    title: `${content.candidateName} — Fit Assessment`,
    styles: { default: { document: { run: { font: SANS, size: 21, color: INK } } } },
    numbering: {
      config: [
        {
          reference: 'fb',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '▪',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 350, hanging: 196 } }, run: { color: COPPER } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 0, right: 1040, bottom: 760, left: 1040 },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}

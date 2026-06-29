// ATS-safe Fit Assessment builder — the third packet document, rendered from the deterministic
// engine's FitResult (8 weighted dimensions + base/bonus/penalties + band). Same locked design
// recipes as resume.ts (dark text on light; single column, no tables/images, real selectable text).
// Runs only under runtime='nodejs' (Packer.toBuffer needs Node Buffer).
//
// COLOR is themed; TYPOGRAPHY is not (the assessment is a decision aid, not an employer-facing doc,
// so fonts stay fixed — no FontPair param). Tokens: NAVY→theme.primary, WASH→theme.wash,
// SLATE→theme.slate, INK→fixed '1A1A1A'. The copper accent uses the COLLISION-GUARDED accent
// (`accent.color` from resolveAssessmentAccent) so the brand accent can never read as a status
// color — never theme.accent directly.
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
import type { Theme, AssessmentAccentResult } from '@/lib/style/types'

// Fonts are intentionally NOT themed for the assessment (see header note).
const SERIF = 'Cambria'
const SANS = 'Calibri'

export interface FitDimensionLine {
  label: string
  score: number
  weight: number
  note: string
}

export interface FitAssessmentContent {
  candidateName: string
  roleTitle: string
  company: string
  date: string
  overall: number
  band: string
  base: number
  bonus: number
  penaltyTotal: number
  dimensions: FitDimensionLine[]
  hardGaps: string[]
}

export async function buildFitAssessmentDocx(
  content: FitAssessmentContent,
  theme: Theme,
  accent: AssessmentAccentResult,
): Promise<Buffer> {
  const NAVY = theme.primary
  const ACCENT = accent.color // collision-guarded brand accent (never a status color)
  const INK = '1A1A1A'
  const SLATE = theme.slate
  const WASH = theme.wash

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
        new TextRun({ text: '■  ', font: SANS, size: 22, color: ACCENT }),
        new TextRun({ text: text.toUpperCase(), font: SERIF, bold: true, size: 26, color: NAVY, characterSpacing: 44 }),
      ],
    })

  const dimensionLine = (d: FitDimensionLine) =>
    new Paragraph({
      spacing: { before: 70, after: 60, line: 268 },
      tabStops: [{ type: TabStopType.RIGHT, position: 9420 }],
      children: [
        new TextRun({ text: d.label, font: SANS, bold: true, size: 21, color: NAVY }),
        new TextRun({ text: `  (weight ${Math.round(d.weight * 100)}%)`, font: SANS, size: 18, color: SLATE }),
        new TextRun({ text: `\t${d.score} / 100`, font: SANS, bold: true, size: 21, color: ACCENT }),
        // `break: 1` inserts a real <w:br/>; a literal '\n' inside a TextRun does NOT wrap in Word.
        ...(d.note ? [new TextRun({ text: d.note, break: 1, font: SANS, size: 20, color: SLATE })] : []),
      ],
    })

  const gapItem = (text: string) =>
    new Paragraph({
      numbering: { reference: 'fb', level: 0 },
      spacing: { before: 16, after: 16, line: 264 },
      children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
    })

  const subtitle = [content.roleTitle, content.company].filter(Boolean).join('  ·  ')
  const mathLine = `Weighted base ${content.base}, cross-lane bonus +${content.bonus}, penalties −${content.penaltyTotal}.`

  const children: Paragraph[] = [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: ACCENT, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),
    headLine([new TextRun({ text: content.candidateName.toUpperCase(), font: SERIF, bold: true, size: 46, color: NAVY, characterSpacing: 70 })], { before: 60, line: 480 }),
    headLine([new TextRun({ text: 'FIT ASSESSMENT', font: SANS, bold: true, size: 22, color: ACCENT, characterSpacing: 66 })], { before: 20, line: 250 }),
    ...(subtitle
      ? [headLine([new TextRun({ text: subtitle, font: SANS, size: 20, color: SLATE, characterSpacing: 16 })], { before: 12, line: 235 })]
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
        new TextRun({ text: `    ${content.band}`, font: SANS, bold: true, size: 24, color: ACCENT }),
      ],
    }),
    new Paragraph({
      spacing: { before: 10, after: 50, line: 276 },
      children: [new TextRun({ text: mathLine, font: SANS, size: 19, color: SLATE })],
    }),

    sectionHeader('Assessment by dimension'),
    ...content.dimensions.map(dimensionLine),
  ]

  if (content.hardGaps.length > 0) {
    children.push(sectionHeader('Hard gaps'), ...content.hardGaps.map(gapItem))
  }

  children.push(
    new Paragraph({
      spacing: { before: 200, after: 0 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Deterministic assessment (rubric 1.0.0) from your structured history and stated preferences. A decision aid for you — it is not submitted to the employer.',
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
              style: { paragraph: { indent: { left: 350, hanging: 196 } }, run: { color: ACCENT } },
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

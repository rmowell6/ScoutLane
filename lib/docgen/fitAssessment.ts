// ATS-safe Fit Assessment builder, the third packet document, rendered from the deterministic
// engine's FitResult (8 weighted dimensions + base/bonus/penalties + band). Same locked design
// recipes as resume.ts (dark text on light; single column, no tables/images, real selectable text).
// Runs only under runtime='nodejs' (Packer.toBuffer needs Node Buffer).
//
// COLOR is themed; TYPOGRAPHY is not (the assessment is a decision aid, not an employer-facing doc,
// so fonts stay fixed, no FontPair param). Tokens: NAVY→theme.primary, WASH→theme.wash,
// SLATE→theme.slate, INK→fixed '1A1A1A'. The copper accent uses the COLLISION-GUARDED accent
// (`accent.color` from resolveAssessmentAccent) so the brand accent can never read as a status
// color, never theme.accent directly.
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

export type FitDimGroup = 'strength' | 'stretch' | 'unassessed'

export interface FitDimensionLine {
  label: string
  /** "85 / 100" for an assessed dimension, "Not assessed" for a neutral placeholder. */
  scoreText: string
  /** Humanized, candidate-facing note (no raw engine strings). */
  note: string
  /** Which group this dimension belongs to, for strengths-first sub-headers. */
  group: FitDimGroup
}

export interface FitAssessmentContent {
  candidateName: string
  roleTitle: string
  company: string
  date: string
  overall: number
  /** Candidate-facing band label (e.g. "Long shot", not the internal "Lead"). */
  bandLabel: string
  /** Warm one-line read on the band. */
  bandSummary: string
  /** Plain-language "what's holding this back" (may be empty). */
  holdingBack: string
  /** Dimensions already humanized + ordered strengths -> stretches -> not assessed. */
  dimensions: FitDimensionLine[]
  hardGaps: string[]
  /** JD preferred / nice-to-have keywords + the candidate's coverage. Display-only (does NOT affect
   *  the score). Empty when the JD lists no preferred skills. */
  preferredSkills: { skill: string; status: 'match' | 'partial' | 'gap' }[]
}

const PREFERRED_STATUS_TEXT: Record<'match' | 'partial' | 'gap', string> = {
  match: 'In your background',
  partial: 'Partial / cert-backed',
  gap: 'Not present',
}

const GROUP_TITLES: Record<FitDimGroup, string> = {
  strength: 'Your strengths',
  stretch: 'Worth shoring up',
  unassessed: 'Not assessed',
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

  // Strengths-first sub-header within "Assessment by dimension".
  const groupHeader = (group: FitDimGroup) =>
    new Paragraph({
      spacing: { before: 150, after: 20 },
      children: [
        new TextRun({ text: GROUP_TITLES[group].toUpperCase(), font: SANS, bold: true, size: 18, color: ACCENT, characterSpacing: 30 }),
      ],
    })

  const dimensionLine = (d: FitDimensionLine) =>
    new Paragraph({
      spacing: { before: 70, after: 60, line: 268 },
      tabStops: [{ type: TabStopType.RIGHT, position: 9420 }],
      children: [
        new TextRun({ text: d.label, font: SANS, bold: true, size: 21, color: NAVY }),
        // Assessed scores use the brand accent; "Not assessed" is muted so it never reads as a verdict.
        new TextRun({ text: `\t${d.scoreText}`, font: SANS, bold: d.group !== 'unassessed', size: 21, color: d.group === 'unassessed' ? SLATE : ACCENT }),
        // `break: 1` inserts a real <w:br/>; a literal '\n' inside a TextRun does NOT wrap in Word.
        ...(d.note ? [new TextRun({ text: d.note, break: 1, font: SANS, size: 20, color: SLATE })] : []),
      ],
    })

  // Render dimensions in their pre-ordered groups, emitting a sub-header when the group changes.
  const dimensionParagraphs: Paragraph[] = []
  let lastGroup: FitDimGroup | null = null
  for (const d of content.dimensions) {
    if (d.group !== lastGroup) {
      dimensionParagraphs.push(groupHeader(d.group))
      lastGroup = d.group
    }
    dimensionParagraphs.push(dimensionLine(d))
  }

  const gapItem = (text: string) =>
    new Paragraph({
      numbering: { reference: 'fb', level: 0 },
      spacing: { before: 16, after: 16, line: 264 },
      children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
    })

  const subtitle = [content.roleTitle, content.company].filter(Boolean).join('  ·  ')

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
      spacing: { before: 80, after: 30 },
      children: [
        new TextRun({ text: `${content.overall} / 100`, font: SERIF, bold: true, size: 40, color: NAVY }),
        new TextRun({ text: `    ${content.bandLabel}`, font: SANS, bold: true, size: 24, color: ACCENT }),
      ],
    }),
    new Paragraph({
      spacing: { before: 6, after: content.holdingBack ? 16 : 50, line: 276 },
      children: [new TextRun({ text: content.bandSummary, font: SANS, size: 21, color: INK })],
    }),
    ...(content.holdingBack
      ? [
          new Paragraph({
            spacing: { before: 0, after: 50, line: 276 },
            children: [new TextRun({ text: content.holdingBack, font: SANS, italics: true, size: 19, color: SLATE })],
          }),
        ]
      : []),

    sectionHeader('Assessment by dimension'),
    ...dimensionParagraphs,
  ]

  if (content.hardGaps.length > 0) {
    children.push(sectionHeader('Hard gaps'), ...content.hardGaps.map(gapItem))
  }

  if (content.preferredSkills.length > 0) {
    const prefLine = (p: { skill: string; status: 'match' | 'partial' | 'gap' }) =>
      new Paragraph({
        spacing: { before: 40, after: 40, line: 264 },
        tabStops: [{ type: TabStopType.RIGHT, position: 9420 }],
        children: [
          new TextRun({ text: p.skill, font: SANS, size: 21, color: NAVY }),
          new TextRun({
            text: `\t${PREFERRED_STATUS_TEXT[p.status]}`,
            font: SANS,
            size: 20,
            color: p.status === 'match' ? ACCENT : SLATE,
          }),
        ],
      })
    children.push(
      sectionHeader('Preferred keywords (nice-to-have)'),
      new Paragraph({
        spacing: { before: 20, after: 60, line: 268 },
        children: [
          new TextRun({
            text: 'These help with ATS keyword matching but do NOT affect the score above, so a gap here is not a strike against you.',
            font: SANS,
            italics: true,
            size: 19,
            color: SLATE,
          }),
        ],
      }),
      ...content.preferredSkills.map(prefLine),
    )
  }

  children.push(
    new Paragraph({
      spacing: { before: 200, after: 0 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Built from your structured history and stated preferences. This is a private decision aid, separate from the resume and cover letter you download.',
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
    title: `${content.candidateName} · Fit Assessment`,
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

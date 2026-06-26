// ATS-safe resume builder — ported from resume_template_build.js, the LOCKED design system
// (Ryan_Resume_Template_SPEC.md). Design tokens, builder recipes, and section structure are
// preserved EXACTLY; only the content is parameterized by ResumeContent so it works for any
// target role. Runs only in routes with runtime='nodejs' (Packer.toBuffer needs Node Buffer).
//
// Non-negotiable design principle: legibility never depends on a background fill — all text is
// DARK on a LIGHT surface; structure comes from type scale, the copper accent, and BORDER rules.
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
  type IParagraphOptions,
} from 'docx'

// ---- design tokens (locked) ------------------------------------------------------
const SERIF = 'Cambria'
const SANS = 'Calibri'

const NAVY = '16335B' // name, section headers, company/school names
const COPPER = 'B0682C' // the single accent
const INK = '1A1A1A' // body
const SLATE = '55606E' // muted / context
const WASH = 'EAEEF4' // very light header wash (text stays dark)

// ---- content model ---------------------------------------------------------------
export interface ContactInfo {
  location: string
  phone: string
  email: string
}
export interface SkillCategory {
  label: string
  items: string
}
export interface ExperienceEntry {
  company: string
  dates: string
  title: string
  context: string
  bullets: string[]
}
export interface EarlierEntry {
  company: string
  role: string
  detail: string
}
export interface CertEntry {
  name: string
  note?: string
}
export interface EducationEntry {
  school: string
  detail: string
}
export interface ResumeContent {
  name: string
  tagline: string // role under the name (target role)
  subtitle: string
  contact: ContactInfo
  summary: string
  skillCategories: SkillCategory[]
  experience: ExperienceEntry[]
  earlier: EarlierEntry[]
  certs: { active: CertEntry[]; previouslyHeld: CertEntry[] }
  education: EducationEntry[]
  authLine: string
}

// ---- builders (recipes preserved verbatim) ---------------------------------------
const headLine = (
  children: TextRun[],
  opts: { before?: number; after?: number; line?: number; border?: IParagraphOptions['border'] } = {},
) =>
  new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
    spacing: { before: opts.before ?? 0, after: opts.after ?? 0, line: opts.line ?? 240 },
    alignment: AlignmentType.CENTER,
    border: opts.border,
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

const bullet = (text: string) =>
  new Paragraph({
    numbering: { reference: 'rb', level: 0 },
    spacing: { before: 20, after: 20, line: 262 },
    children: [new TextRun({ text, font: SANS, size: 21, color: INK })],
  })

const jobHeader = (company: string, dates: string) =>
  new Paragraph({
    spacing: { before: 170, after: 0 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9420 }],
    children: [
      new TextRun({ text: company, font: SERIF, bold: true, size: 24, color: NAVY }),
      new TextRun({ text: '\t' + dates, font: SANS, bold: true, size: 20, color: COPPER }),
    ],
  })

const jobTitle = (title: string) =>
  new Paragraph({
    spacing: { before: 2, after: 60 },
    children: [new TextRun({ text: title, font: SANS, italics: true, size: 21, color: SLATE })],
  })

const jobContext = (text: string) =>
  new Paragraph({
    spacing: { before: 0, after: 58, line: 262 },
    children: [new TextRun({ text, font: SANS, size: 20, color: SLATE })],
  })

const skillLine = (cat: string, items: string) =>
  new Paragraph({
    spacing: { before: 24, after: 24, line: 266 },
    children: [
      new TextRun({ text: cat, font: SANS, bold: true, size: 21, color: NAVY }),
      new TextRun({ text: '   ', font: SANS, size: 21 }),
      new TextRun({ text: items, font: SANS, size: 21, color: INK }),
    ],
  })

const earlierLine = (co: string, role: string, detail: string) =>
  new Paragraph({
    spacing: { before: 50, after: 36, line: 264 },
    children: [
      new TextRun({ text: co, font: SERIF, bold: true, size: 21, color: NAVY }),
      new TextRun({ text: '   •   ', font: SANS, size: 20, color: COPPER }),
      new TextRun({ text: role + '.  ', font: SANS, italics: true, size: 20, color: SLATE }),
      new TextRun({ text: detail, font: SANS, size: 20, color: SLATE }),
    ],
  })

const certSub = (t: string) =>
  new Paragraph({
    spacing: { before: 64, after: 14 },
    children: [new TextRun({ text: t.toUpperCase(), font: SANS, bold: true, size: 18, color: COPPER, characterSpacing: 34 })],
  })

const certItem = (name: string, note?: string) =>
  new Paragraph({
    numbering: { reference: 'rb', level: 0 },
    spacing: { before: 16, after: 16, line: 264 },
    children: [
      new TextRun({ text: name, font: SANS, bold: true, size: 21, color: INK }),
      ...(note ? [new TextRun({ text: '  ' + note, font: SANS, italics: true, size: 19, color: SLATE })] : []),
    ],
  })

const eduLine = (school: string, detail: string) =>
  new Paragraph({
    spacing: { before: 44, after: 32, line: 264 },
    children: [
      new TextRun({ text: school, font: SERIF, bold: true, size: 22, color: NAVY }),
      new TextRun({ text: '   •   ', font: SANS, size: 20, color: COPPER }),
      new TextRun({ text: detail, font: SANS, size: 21, color: INK }),
    ],
  })

function headerBlock(content: ResumeContent): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 0, after: 0, line: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: COPPER, space: 0 } },
      children: [new TextRun({ text: '', font: SANS, size: 2 })],
    }),
    headLine([new TextRun({ text: '', font: SANS, size: 12 })], { line: 150 }),
    headLine([new TextRun({ text: content.name.toUpperCase(), font: SERIF, bold: true, size: 52, color: NAVY, characterSpacing: 84 })], { line: 540 }),
    headLine([new TextRun({ text: content.tagline.toUpperCase(), font: SANS, bold: true, size: 22, color: COPPER, characterSpacing: 66 })], { before: 30, line: 250 }),
    headLine([new TextRun({ text: content.subtitle, font: SANS, size: 20, color: SLATE, characterSpacing: 16 })], { before: 12, line: 235 }),
    headLine(
      [
        new TextRun({ text: content.contact.location, font: SANS, size: 19, color: INK }),
        new TextRun({ text: '       •       ', font: SANS, size: 19, color: COPPER }),
        new TextRun({ text: content.contact.phone, font: SANS, size: 19, color: INK }),
        new TextRun({ text: '       •       ', font: SANS, size: 19, color: COPPER }),
        new TextRun({ text: content.contact.email, font: SANS, size: 19, color: INK }),
      ],
      { before: 80, line: 250 },
    ),
    headLine([new TextRun({ text: '', font: SANS, size: 12 })], {
      line: 150,
      after: 0,
      border: { bottom: { style: BorderStyle.SINGLE, size: 26, color: NAVY, space: 0 } },
    }),
  ]
}

export async function buildResumeDocx(content: ResumeContent): Promise<Buffer> {
  const children: Paragraph[] = [
    ...headerBlock(content),

    sectionHeader('Summary'),
    new Paragraph({
      spacing: { before: 70, after: 50, line: 284 },
      children: [new TextRun({ text: content.summary, font: SANS, size: 21, color: INK })],
    }),

    sectionHeader('Technical Skills'),
    ...content.skillCategories.map((s) => skillLine(s.label, s.items)),

    sectionHeader('Professional Experience'),
    ...content.experience.flatMap((e) => [
      jobHeader(e.company, e.dates),
      jobTitle(e.title),
      jobContext(e.context),
      ...e.bullets.map(bullet),
    ]),

    sectionHeader('Earlier Experience'),
    ...content.earlier.map((e) => earlierLine(e.company, e.role, e.detail)),

    sectionHeader('Certifications'),
    certSub('Active'),
    ...content.certs.active.map((c) => certItem(c.name, c.note)),
    certSub('Previously Held'),
    ...content.certs.previouslyHeld.map((c) => certItem(c.name, c.note)),

    sectionHeader('Education'),
    ...content.education.map((e) => eduLine(e.school, e.detail)),

    new Paragraph({
      spacing: { before: 170, after: 0 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: content.authLine, font: SANS, italics: true, size: 18, color: SLATE })],
    }),
  ]

  const doc = new Document({
    creator: content.name,
    title: `${content.name} — ${content.tagline} Resume`,
    styles: { default: { document: { run: { font: SANS, size: 21, color: INK } } } },
    numbering: {
      config: [
        {
          reference: 'rb',
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

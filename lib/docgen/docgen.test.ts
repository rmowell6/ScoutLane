import { describe, expect, test } from 'vitest'
import JSZip from 'jszip'
import { buildResumeDocx, type ResumeContent } from '@/lib/docgen/resume'
import { buildCoverLetterDocx, type CoverLetterContent } from '@/lib/docgen/coverLetter'
import { buildFitAssessmentDocx, type FitAssessmentContent } from '@/lib/docgen/fitAssessment'
import { buildResumePdf, buildCoverLetterPdf, buildFitAssessmentPdf } from '@/lib/docgen/pdf'
import themes from '@/lib/style/themes.json'
import fonts from '@/lib/style/fonts.json'
import { resolveAssessmentAccent } from '@/lib/style/assessmentAccent'
import type { Theme, FontPair } from '@/lib/style/types'

// Master skin for the builder tests (the builders are theme/font-parameterized).
const theme = (themes.themes as Theme[]).find((t) => t.master)!
const font = (fonts.pairs as FontPair[]).find((f) => f.master)!
const accent = resolveAssessmentAccent(theme)

const sampleResume: ResumeContent = {
  name: 'Jordan Rivera',
  tagline: 'Senior Cloud Engineer',
  subtitle: 'Azure · Hybrid Infrastructure',
  contact: { location: 'Austin, TX', phone: '555-555-5555', email: 'jordan.rivera@example.com' },
  summary: 'Cloud and infrastructure engineer with over a decade running Azure and hybrid environments.',
  skillCategories: [{ label: 'Microsoft Azure', items: 'Virtual Machines, Storage, VNets, Entra ID, RBAC' }],
  experience: [
    {
      company: 'Northwind Health',
      dates: '2024 - Present',
      title: 'Cloud & Infrastructure Engineer',
      context: 'Run hybrid Azure and on-prem infrastructure for a healthcare services firm.',
      bullets: ['Own Azure and on-prem operations across the engineering org.'],
    },
  ],
  earlier: [{ company: 'Lakeside Credit Union', role: 'Network Administrator', detail: 'Sole network admin across HQ and twelve branches.' }],
  certs: {
    active: [{ name: 'VMware Certified Professional (VCP-DCV)' }],
    previouslyHeld: [{ name: 'AWS Solutions Architect Associate', note: '(held 5 years)' }],
  },
  education: [{ school: 'Riverside Community College', detail: 'AAS, Network Engineering' }],
  authLine: 'Authorized to work in the U.S. for any employer',
}

const sampleCover: CoverLetterContent = {
  candidate: {
    name: 'Jordan Rivera',
    tagline: 'Senior Cloud Engineer',
    location: sampleResume.contact.location,
    phone: sampleResume.contact.phone,
    email: sampleResume.contact.email,
  },
  date: 'June 26, 2026',
  recipient: 'Acme, Inc.',
  reLine: 'Re: Senior Cloud Engineer',
  salutation: 'Dear Hiring Team,',
  paragraphs: ['I am excited to apply for the role.', 'My Azure background fits the work you described.'],
  closing: 'Sincerely,',
  signature: 'Jordan Rivera',
}

const sampleFit: FitAssessmentContent = {
  candidateName: 'Jordan Rivera',
  roleTitle: 'Senior Cloud Engineer',
  company: 'Acme',
  date: 'June 27, 2026',
  overall: 82,
  bandLabel: 'Strong fit',
  bandSummary: 'A strong match with a couple of honest stretches, well worth tailoring a packet for.',
  holdingBack: 'Biggest gap: Core skills coverage (70/100).',
  dimensions: [
    { label: 'Role-type match', scoreText: '80 / 100', note: 'Your title lines up closely with this role.', group: 'strength' },
    { label: 'Core skills coverage', scoreText: '70 / 100', note: 'You bring 3 of the 5 must-have skills.', group: 'stretch' },
  ],
  hardGaps: ['people management'],
  preferredSkills: [
    { skill: 'terraform', status: 'match' },
    { skill: 'kubernetes', status: 'gap' },
  ],
}

/** OOXML .docx files are ZIP archives, they start with the "PK" local-file-header magic. */
function isDocxBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b
}

/** PDF files start with the "%PDF-" magic bytes. */
function isPdfBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length > 500 && buf.subarray(0, 5).toString() === '%PDF-'
}

/** Unzip a .docx buffer and return the raw word/document.xml body. */
async function documentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  return zip.file('word/document.xml')!.async('string')
}

/** Count <w:p> paragraph elements (both <w:p>…</w:p> and self-closing <w:p/>). */
function paragraphCount(xml: string): number {
  return (xml.match(/<w:p[ >/]/g) ?? []).length
}

describe('docgen', () => {
  test('buildResumeDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildResumeDocx(sampleResume, theme, font)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('an empty role context adds no phantom paragraph (consistent spacing)', async () => {
    // mapProfile currently always passes context: '' (no per-role context in the schema yet). An
    // empty context must NOT emit a blank spacer paragraph between the job title and the bullets, 
    // otherwise the experience section gains a phantom gap that reads as inconsistent spacing.
    const withContext = await documentXml(await buildResumeDocx(sampleResume, theme, font))
    const emptyContext = await documentXml(
      await buildResumeDocx(
        { ...sampleResume, experience: sampleResume.experience.map((e) => ({ ...e, context: '' })) },
        theme,
        font,
      ),
    )
    // Exactly one fewer paragraph per role when the context line is dropped (here: one role).
    expect(paragraphCount(emptyContext)).toBe(paragraphCount(withContext) - sampleResume.experience.length)
    // The dropped context text is gone; the bullet it used to sit above still renders.
    expect(emptyContext).not.toContain('Run hybrid Azure and on-prem infrastructure')
    expect(emptyContext).toContain('Own Azure and on-prem operations across the engineering org')
  })

  test('buildCoverLetterDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildCoverLetterDocx(sampleCover, theme, font)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildFitAssessmentDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildFitAssessmentDocx(sampleFit, theme, accent)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('the three PDF builders produce valid %PDF buffers', async () => {
    const [resume, cover, fit] = await Promise.all([
      buildResumePdf(sampleResume, theme),
      buildCoverLetterPdf(sampleCover, theme),
      buildFitAssessmentPdf(sampleFit, theme, accent),
    ])
    expect(isPdfBuffer(resume)).toBe(true)
    expect(isPdfBuffer(cover)).toBe(true)
    expect(isPdfBuffer(fit)).toBe(true)
  })

  test('PDF builders tolerate empty/minimal content without throwing', async () => {
    const bareResume = await buildResumePdf(
      { ...sampleResume, summary: '', skillCategories: [], experience: [], earlier: [], education: [], authLine: '' },
      theme,
    )
    const bareFit = await buildFitAssessmentPdf(
      { ...sampleFit, holdingBack: '', dimensions: [], hardGaps: [], preferredSkills: [] },
      theme,
      accent,
    )
    expect(isPdfBuffer(bareResume)).toBe(true)
    expect(isPdfBuffer(bareFit)).toBe(true)
  })

  test('buildFitAssessmentDocx tolerates empty dimensions and hard gaps', async () => {
    const buf = await buildFitAssessmentDocx({
      candidateName: 'Ada',
      roleTitle: '',
      company: '',
      date: 'x',
      overall: 40,
      bandLabel: 'Long shot',
      bandSummary: 'A reach for now. Weigh it against roles that fit more of your background.',
      holdingBack: '',
      dimensions: [],
      hardGaps: [],
      preferredSkills: [],
    }, theme, accent)
    expect(isDocxBuffer(buf)).toBe(true)
  })
})

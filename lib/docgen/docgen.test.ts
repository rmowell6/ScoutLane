import { describe, expect, test } from 'vitest'
import { buildResumeDocx, type ResumeContent } from '@/lib/docgen/resume'
import { buildCoverLetterDocx, type CoverLetterContent } from '@/lib/docgen/coverLetter'
import { buildFitAssessmentDocx, type FitAssessmentContent } from '@/lib/docgen/fitAssessment'
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

/** OOXML .docx files are ZIP archives — they start with the "PK" local-file-header magic. */
function isDocxBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b
}

describe('docgen', () => {
  test('buildResumeDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildResumeDocx(sampleResume, theme, font)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildCoverLetterDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildCoverLetterDocx(sampleCover, theme, font)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildFitAssessmentDocx produces a non-trivial .docx buffer', async () => {
    const content: FitAssessmentContent = {
      candidateName: 'Jordan Rivera',
      roleTitle: 'Senior Cloud Engineer',
      company: 'Acme',
      date: 'June 27, 2026',
      overall: 82,
      band: 'Strong fit',
      base: 81.7,
      bonus: 0,
      penaltyTotal: 0,
      dimensions: [
        { label: 'Role-type match', score: 80, weight: 0.2, note: 'Target-title fit: solid.' },
        { label: 'Core skills coverage', score: 70, weight: 0.22, note: '3 of 5 must-haves matched.' },
      ],
      hardGaps: ['people management'],
    }
    const buf = await buildFitAssessmentDocx(content, theme, accent)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildFitAssessmentDocx tolerates empty dimensions and hard gaps', async () => {
    const buf = await buildFitAssessmentDocx({
      candidateName: 'Ada',
      roleTitle: '',
      company: '',
      date: 'x',
      overall: 40,
      band: 'Lead',
      base: 40,
      bonus: 0,
      penaltyTotal: 0,
      dimensions: [],
      hardGaps: [],
    }, theme, accent)
    expect(isDocxBuffer(buf)).toBe(true)
  })
})

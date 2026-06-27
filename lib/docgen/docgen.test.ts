import { describe, expect, test } from 'vitest'
import { buildResumeDocx, type ResumeContent } from '@/lib/docgen/resume'
import { buildCoverLetterDocx, type CoverLetterContent } from '@/lib/docgen/coverLetter'
import { buildFitAssessmentDocx, type FitAssessmentContent } from '@/lib/docgen/fitAssessment'

const sampleResume: ResumeContent = {
  name: 'Ryan Mowell',
  tagline: 'Senior Cloud Engineer',
  subtitle: 'Azure · Hybrid Infrastructure',
  contact: { location: 'Lebanon, OH', phone: '555-555-5555', email: 'ryan@example.com' },
  summary: 'Cloud and infrastructure engineer with over a decade running Azure and hybrid environments.',
  skillCategories: [{ label: 'Microsoft Azure', items: 'Virtual Machines, Storage, VNets, Entra ID, RBAC' }],
  experience: [
    {
      company: 'Signature Performance',
      dates: '2024 - Present',
      title: 'Cloud & Infrastructure Engineer',
      context: 'Run hybrid Azure and on-prem infrastructure for a healthcare services firm.',
      bullets: ['Own Azure and on-prem operations across the engineering org.'],
    },
  ],
  earlier: [{ company: 'Kemba Credit Union', role: 'Network Administrator', detail: 'Sole network admin across HQ and twelve branches.' }],
  certs: {
    active: [{ name: 'VMware Certified Professional (VCP-DCV)' }],
    previouslyHeld: [{ name: 'AWS Solutions Architect Associate', note: '(held 5 years)' }],
  },
  education: [{ school: 'Sinclair Community College', detail: 'AAS, Network Engineering' }],
  authLine: 'Authorized to work in the U.S. for any employer',
}

const sampleCover: CoverLetterContent = {
  candidate: {
    name: 'Ryan Mowell',
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
  signature: 'Ryan Mowell',
}

/** OOXML .docx files are ZIP archives — they start with the "PK" local-file-header magic. */
function isDocxBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b
}

describe('docgen', () => {
  test('buildResumeDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildResumeDocx(sampleResume)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildCoverLetterDocx produces a non-trivial .docx buffer', async () => {
    const buf = await buildCoverLetterDocx(sampleCover)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildFitAssessmentDocx produces a non-trivial .docx buffer', async () => {
    const content: FitAssessmentContent = {
      candidateName: 'Ryan Mowell',
      roleTitle: 'Senior Cloud Engineer',
      company: 'Acme',
      date: 'June 27, 2026',
      overall: 62,
      band: 'Solid fit',
      recommendation: 'A solid match — apply, and lean into the strongest dimensions.',
      dimensions: [
        { label: 'skills', score: 75, note: 'Strong Azure overlap.' },
        { label: 'experience', score: 55, note: 'Adjacent but not exact.' },
      ],
      reasonCodes: ['Strong domain', 'Mid seniority'],
    }
    const buf = await buildFitAssessmentDocx(content)
    expect(isDocxBuffer(buf)).toBe(true)
  })

  test('buildFitAssessmentDocx tolerates empty dimensions and reason codes', async () => {
    const buf = await buildFitAssessmentDocx({
      candidateName: 'Ada',
      roleTitle: '',
      company: '',
      date: 'x',
      overall: 30,
      band: 'Reach',
      recommendation: 'A reach for now.',
      dimensions: [],
      reasonCodes: [],
    })
    expect(isDocxBuffer(buf)).toBe(true)
  })
})

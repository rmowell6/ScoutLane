import { describe, expect, test } from 'vitest'
import { toCoverLetterContent, toFitAssessmentContent, toResumeContent } from '@/lib/docgen/mapProfile'
import type { FitScore, JobReqs, Profile, TailoredContent } from '@/lib/schemas'

const profile: Profile = {
  name: 'Ryan Mowell',
  contact: { location: 'Lebanon, OH', phone: '555', email: 'r@example.com' },
  summary: 'Original summary.',
  skills: ['Azure', 'VMware', 'Veeam', 'PowerShell'],
  roles: [
    { company: 'Signature Performance', title: 'Cloud Engineer', startDate: '2024', endDate: null, bullets: ['Ran Azure under HIPAA'] },
  ],
  certs: ['VCP-DCV'],
  education: [{ school: 'Sinclair', degree: 'AAS', field: 'Network Engineering', year: '2015' }],
}

const tailored: TailoredContent = {
  summary: 'Tailored summary for the role.',
  skills: ['Azure', 'VMware', 'Security'],
  claims: [],
  coverLetter: 'Para one.\n\nPara two about Azure.',
}

const jobReqs: JobReqs = { title: 'Senior Cloud Engineer', company: 'Acme', mustHave: [], niceToHave: [] }

describe('toResumeContent', () => {
  test('uses the tailored summary, job title as tagline, and maps roles/certs/education', () => {
    const rc = toResumeContent(profile, tailored, jobReqs)
    expect(rc.tagline).toBe('Senior Cloud Engineer')
    expect(rc.summary).toBe('Tailored summary for the role.')
    expect(rc.contact.location).toBe('Lebanon, OH')
    expect(rc.experience[0]?.dates).toBe('2024 – Present')
    expect(rc.certs.active[0]?.name).toBe('VCP-DCV')
    expect(rc.education[0]?.detail).toContain('Network Engineering')
  })

  test('falls back to profile skills/summary and empty contact when tailored/contact are missing', () => {
    const rc = toResumeContent(
      { ...profile, contact: undefined },
      { ...tailored, skills: [], summary: '' },
      { mustHave: [], niceToHave: [] },
    )
    expect(rc.tagline).toBe('Candidate')
    expect(rc.summary).toBe('Original summary.')
    expect(rc.skillCategories[0]?.items).toContain('PowerShell')
    expect(rc.contact).toEqual({ location: '', phone: '', email: '' })
  })
})

describe('toCoverLetterContent', () => {
  test('splits the cover letter into paragraphs and addresses the company', () => {
    const cl = toCoverLetterContent(profile, tailored, jobReqs, 'June 27, 2026')
    expect(cl.salutation).toBe('Dear Acme Hiring Team,')
    expect(cl.reLine).toBe('Re: Senior Cloud Engineer')
    expect(cl.paragraphs).toEqual(['Para one.', 'Para two about Azure.'])
    expect(cl.candidate.name).toBe('Ryan Mowell')
    expect(cl.date).toBe('June 27, 2026')
  })

  test('strips em dashes from JD-derived fields so the cover letter never trips assertNoEmDash', () => {
    const cl = toCoverLetterContent(profile, tailored, { title: 'Lead — Cloud', company: 'A — B', mustHave: [], niceToHave: [] }, 'x')
    expect(cl.reLine.includes('—')).toBe(false)
    expect(cl.salutation.includes('—')).toBe(false)
  })
})

describe('toFitAssessmentContent', () => {
  const fit: FitScore = {
    overall: 62,
    subs: [
      { label: 'skills', score: 75, note: 'Strong overlap.' },
      { label: 'experience', score: 55, note: 'Adjacent.' },
    ],
    reasonCodes: ['strong-domain', 'mid_seniority'],
  }

  test('derives band/recommendation, maps dimensions, and humanizes reason codes', () => {
    const fa = toFitAssessmentContent(profile, fit, jobReqs, 'June 27, 2026')
    expect(fa.candidateName).toBe('Ryan Mowell')
    expect(fa.roleTitle).toBe('Senior Cloud Engineer')
    expect(fa.company).toBe('Acme')
    expect(fa.overall).toBe(62)
    expect(fa.band).toBe('Solid fit')
    expect(fa.recommendation.length).toBeGreaterThan(0)
    expect(fa.dimensions).toEqual([
      { label: 'skills', score: 75, note: 'Strong overlap.' },
      { label: 'experience', score: 55, note: 'Adjacent.' },
    ])
    expect(fa.reasonCodes).toEqual(['Strong domain', 'Mid seniority'])
  })

  test('falls back to a generic role label when the JD has no title', () => {
    const fa = toFitAssessmentContent(profile, fit, { mustHave: [], niceToHave: [] }, 'x')
    expect(fa.roleTitle).toBe('Target role')
    expect(fa.company).toBe('')
  })
})

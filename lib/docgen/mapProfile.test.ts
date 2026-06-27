import { describe, expect, test } from 'vitest'
import { toCoverLetterContent, toResumeContent } from '@/lib/docgen/mapProfile'
import type { JobReqs, Profile, TailoredContent } from '@/lib/schemas'

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
    expect(cl.greeting).toBe('Dear Acme Hiring Team,')
    expect(cl.body).toEqual(['Para one.', 'Para two about Azure.'])
    expect(cl.date).toBe('June 27, 2026')
  })
})

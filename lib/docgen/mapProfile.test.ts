import { describe, expect, test } from 'vitest'
import { toCoverLetterContent, toFitAssessmentContent, toResumeContent } from '@/lib/docgen/mapProfile'
import type { JobReqs, Profile, TailoredContent } from '@/lib/schemas'
import type { FitResult } from '@/lib/fit/fitScore'

const profile: Profile = {
  name: 'Jordan Rivera',
  contact: { location: 'Austin, TX', phone: '555', email: 'j@example.com' },
  summary: 'Original summary.',
  skills: ['Azure', 'VMware', 'Veeam', 'PowerShell'],
  roles: [
    { company: 'Northwind Health', title: 'Cloud Engineer', startDate: '2024', endDate: null, bullets: ['Ran Azure under HIPAA'] },
  ],
  certs: [{ name: 'VCP-DCV' }],
  education: [{ school: 'Riverside Community College', degree: 'AAS', field: 'Network Engineering', year: '2015' }],
}

const tailored: TailoredContent = {
  summary: 'Tailored summary for the role.',
  skills: ['Azure', 'VMware', 'Security'],
  claims: [],
  coverLetter: 'Para one.\n\nPara two about Azure.',
  outreach: { linkedin: 'Hi, I bring Azure depth and would value connecting.', email: 'Hello, I admire your team and bring Azure experience. Best, Jordan' },
}

const jobReqs: JobReqs = { title: 'Senior Cloud Engineer', company: 'Acme', mustHave: [], niceToHave: [] }

describe('toResumeContent', () => {
  test('uses the tailored summary, job title as tagline, and maps roles/certs/education', () => {
    const rc = toResumeContent(profile, tailored, jobReqs)
    expect(rc.tagline).toBe('Senior Cloud Engineer')
    expect(rc.summary).toBe('Tailored summary for the role.')
    expect(rc.contact.location).toBe('Austin, TX')
    expect(rc.experience[0]?.dates).toBe('2024 – Present')
    expect(rc.certs.active[0]?.name).toBe('VCP-DCV')
    expect(rc.education[0]?.detail).toContain('Network Engineering')
  })

  test('splits certs into Active vs Previously Held by status (carrying notes)', () => {
    const rc = toResumeContent(
      {
        ...profile,
        certs: [
          { name: 'VCP-DCV', status: 'active' },
          { name: 'AWS SA Associate', status: 'previously_held', note: '(held 5 years)' },
          { name: 'CCNA' }, // status absent == active
        ],
      },
      tailored,
      jobReqs,
    )
    expect(rc.certs.active.map((c) => c.name)).toEqual(['VCP-DCV', 'CCNA'])
    expect(rc.certs.previouslyHeld).toEqual([{ name: 'AWS SA Associate', note: '(held 5 years)' }])
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
    expect(cl.candidate.name).toBe('Jordan Rivera')
    expect(cl.date).toBe('June 27, 2026')
  })

  test('strips em dashes from JD-derived fields so the cover letter never trips assertNoEmDash', () => {
    const cl = toCoverLetterContent(profile, tailored, { title: 'Lead — Cloud', company: 'A — B', mustHave: [], niceToHave: [] }, 'x')
    expect(cl.reLine.includes('—')).toBe(false)
    expect(cl.salutation.includes('—')).toBe(false)
  })

  test('strips a model-supplied salutation, closing, [Your Name] placeholder, and signature', () => {
    const withScaffolding: TailoredContent = {
      ...tailored,
      coverLetter:
        'Dear Acme Hiring Team,\n\nI bring Azure depth.\n\nThank you for your consideration.\n\nSincerely, [Your Name]\n\nJordan Rivera',
    }
    const cl = toCoverLetterContent(profile, withScaffolding, jobReqs, 'June 27, 2026')
    expect(cl.paragraphs).toEqual(['I bring Azure depth.', 'Thank you for your consideration.'])
    // The template still supplies exactly one salutation, closing, and signature.
    expect(cl.salutation).toBe('Dear Acme Hiring Team,')
    expect(cl.closing).toBe('Sincerely,')
    expect(cl.signature).toBe('Jordan Rivera')
  })

  test('does NOT strip body paragraphs that merely begin with a closing/salutation word', () => {
    const tricky: TailoredContent = {
      ...tailored,
      coverLetter:
        'Best of all, I led the Azure migration to completion under budget.\n\nRegards for data privacy shaped my work at the credit union.\n\nDear to me is the mission you describe.',
    }
    const cl = toCoverLetterContent(profile, tricky, jobReqs, 'x')
    expect(cl.paragraphs).toEqual([
      'Best of all, I led the Azure migration to completion under budget.',
      'Regards for data privacy shaped my work at the credit union.',
      'Dear to me is the mission you describe.',
    ])
  })
})

describe('toFitAssessmentContent', () => {
  const fit: FitResult = {
    version: '1.0.0',
    overall: 82,
    band: 'Strong fit',
    base: 81.7,
    bonus: 0,
    penaltyTotal: 0,
    penalties: { hardGaps: 0, expired: 0, unconfirmedLive: 0, defenseAdjacent: 0, heavyTravelOrPresales: 0 },
    hardGaps: ['people management'],
    dimensions: [
      { key: 'roleTypeMatch', label: 'Role-type match', weight: 0.2, score: 80, note: 'Target-title fit: solid.' },
    ],
  }

  test('maps the FitResult onto humanized, grouped doc content (band label, summary, dimensions)', () => {
    const fa = toFitAssessmentContent(profile, fit, jobReqs, 'June 27, 2026')
    expect(fa.candidateName).toBe('Jordan Rivera')
    expect(fa.roleTitle).toBe('Senior Cloud Engineer')
    expect(fa.overall).toBe(82)
    expect(fa.bandLabel).toBe('Strong fit')
    expect(fa.bandSummary).toMatch(/strong match/i)
    // Engine note humanized; score rendered as text; grouped as a strength (80 >= 75).
    expect(fa.dimensions[0]).toMatchObject({
      label: 'Role-type match',
      scoreText: '80 / 100',
      note: 'Your title lines up closely with this role.',
      group: 'strength',
    })
    expect(fa.hardGaps).toEqual(['people management'])
  })
})

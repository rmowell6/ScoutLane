import { describe, expect, test } from 'vitest'
import { checkBannedTerms } from '@/lib/guardrails'
import { BANNED_TERMS } from '@/lib/profileRules'
import type { Profile, TailoredContent } from '@/lib/schemas'

const profile: Profile = {
  name: 'Jordan Rivera',
  summary: 'Cloud engineer.',
  skills: ['Azure', 'VMware', 'Veeam'],
  roles: [],
  certs: [],
  education: [],
}

const tailoredWith = (summary: string): TailoredContent => ({
  summary,
  skills: [],
  claims: [],
  coverLetter: '',
  outreach: { linkedin: '', email: '' },
})

describe('reference profile standing rules (enforced in code)', () => {
  test('BANNED_TERMS blocks Kubernetes/Docker, which are not in the profile', () => {
    const result = checkBannedTerms(tailoredWith('Expert in Kubernetes and Docker.'), profile, BANNED_TERMS)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual(expect.arrayContaining(['Kubernetes', 'Docker']))
  })

  test('does not flag legitimate, profile-backed skills', () => {
    expect(checkBannedTerms(tailoredWith('Strong with Azure and Veeam.'), profile, BANNED_TERMS).ok).toBe(true)
  })
})

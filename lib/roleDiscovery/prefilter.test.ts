import { describe, expect, test } from 'vitest'
import { candidateTerms, prefilter, scoreJob, type MatchableJob } from './prefilter'
import type { Profile } from '@/lib/schemas'

const PROFILE: Profile = {
  name: 'Jordan',
  summary: 'Cloud engineer',
  skills: ['Azure', 'VMware', 'Incident Response', 'PowerShell'],
  certs: ['VCP-DCV'],
  roles: [{ company: 'Acme', title: 'Cloud Engineer', startDate: '2022', endDate: null, bullets: [] }],
  education: [],
}

function job(p: Partial<MatchableJob>): MatchableJob {
  return { id: 'x', provider: 'greenhouse', title: '', company: 'Co', location: null, url: 'u', snippet: '', ...p }
}

describe('candidateTerms', () => {
  test('keeps multi-word skills as phrases and adds tokens, dropping stopwords', () => {
    const terms = candidateTerms(PROFILE, {
      targetLanes: ['Platform Engineer'],
      workModes: [],
      employmentTypes: [],
      noGoLocations: [],
    })
    expect(terms).toContain('incident response') // phrase preserved
    expect(terms).toContain('azure')
    expect(terms).toContain('vmware')
    expect(terms).toContain('platform') // from the target lane (engineer is a stopword)
    expect(terms).not.toContain('engineer') // stopword
  })
})

describe('scoreJob', () => {
  test('title hits outweigh body-only hits, phrases outweigh tokens', () => {
    const terms = candidateTerms(PROFILE)
    const titled = scoreJob(job({ title: 'Azure Platform Engineer', snippet: '' }), terms)
    const bodyOnly = scoreJob(job({ title: 'Operations Lead', snippet: 'azure shop' }), terms)
    expect(titled.score).toBeGreaterThan(bodyOnly.score)
    expect(titled.hits).toContain('azure')
  })

  test('single tokens match on word boundaries, not as substrings', () => {
    const terms = ['azure']
    expect(scoreJob(job({ title: 'Azure Engineer' }), terms).score).toBeGreaterThan(0)
    expect(scoreJob(job({ title: 'Azuremarine Diver' }), terms).score).toBe(0)
  })

  test('multi-word skill matches as a unit in the snippet', () => {
    const terms = candidateTerms(PROFILE)
    const hit = scoreJob(job({ title: 'SRE', snippet: 'lead incident response for outages' }), terms)
    expect(hit.hits).toContain('incident response')
  })
})

describe('prefilter', () => {
  const jobs: MatchableJob[] = [
    job({ id: 'a', title: 'Azure Platform Engineer', snippet: 'vmware azure' }),
    job({ id: 'b', title: 'Barista', snippet: 'make coffee' }),
    job({ id: 'c', title: 'Infrastructure Engineer', snippet: 'powershell automation' }),
  ]

  test('returns only overlapping jobs, highest score first, capped at topK', () => {
    const terms = candidateTerms(PROFILE)
    const out = prefilter(jobs, terms, 2)
    expect(out.map((j) => j.id)).toEqual(['a', 'c']) // b (barista) has no overlap and is dropped
    expect(out.length).toBe(2)
    expect(out[0]!.lexScore).toBeGreaterThanOrEqual(out[1]!.lexScore)
  })

  test('empty term set yields nothing (no false matches)', () => {
    expect(prefilter(jobs, [], 5)).toEqual([])
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchGreenhouse } from './greenhouse'
import { fetchLever } from './lever'
import { fetchAshby } from './ashby'
import type { AtsSource } from './types'

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => payload })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchGreenhouse', () => {
  test('normalizes board jobs and strips HTML content', async () => {
    mockFetchOnce({
      jobs: [
        {
          id: 4321,
          title: 'Senior Cloud Engineer',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/4321',
          location: { name: 'Remote - US' },
          content: '&lt;p&gt;Lead Azure migrations.&lt;/p&gt;',
        },
      ],
    })
    const source: AtsSource = { provider: 'greenhouse', token: 'acme', company: 'Acme' }
    const jobs = await fetchGreenhouse(source)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      provider: 'greenhouse',
      externalId: '4321',
      title: 'Senior Cloud Engineer',
      company: 'Acme',
      location: 'Remote - US',
      url: 'https://boards.greenhouse.io/acme/jobs/4321',
    })
    expect(jobs[0]?.jdText).toBe('Lead Azure migrations.')
  })

  test('tolerates an empty/odd payload', async () => {
    mockFetchOnce({})
    const jobs = await fetchGreenhouse({ provider: 'greenhouse', token: 'x', company: 'X' })
    expect(jobs).toEqual([])
  })
})

describe('fetchLever', () => {
  test('assembles JD from descriptionPlain, lists, and additional', async () => {
    mockFetchOnce([
      {
        id: 'abc-123',
        text: 'Platform Engineer',
        hostedUrl: 'https://jobs.lever.co/acme/abc-123',
        categories: { location: 'NYC', team: 'Infra' },
        descriptionPlain: 'Own the platform.',
        lists: [{ text: 'Requirements', content: '<ul><li>Azure</li><li>VMware</li></ul>' }],
        additionalPlain: 'Equal opportunity employer.',
      },
    ])
    const jobs = await fetchLever({ provider: 'lever', token: 'acme', company: 'Acme' })
    expect(jobs[0]).toMatchObject({
      provider: 'lever',
      externalId: 'abc-123',
      title: 'Platform Engineer',
      location: 'NYC',
    })
    expect(jobs[0]?.jdText).toContain('Own the platform.')
    expect(jobs[0]?.jdText).toContain('Requirements:')
    expect(jobs[0]?.jdText).toContain('Azure')
    expect(jobs[0]?.jdText).toContain('Equal opportunity employer.')
  })
})

describe('fetchAshby', () => {
  test('prefers descriptionPlain', async () => {
    mockFetchOnce({
      jobs: [
        {
          id: 'job_1',
          title: 'SRE',
          location: 'Remote',
          jobUrl: 'https://jobs.ashbyhq.com/acme/job_1',
          descriptionPlain: 'Keep things up.',
        },
      ],
    })
    const jobs = await fetchAshby({ provider: 'ashby', token: 'acme', company: 'Acme' })
    expect(jobs[0]).toMatchObject({ provider: 'ashby', externalId: 'job_1', title: 'SRE', location: 'Remote' })
    expect(jobs[0]?.jdText).toBe('Keep things up.')
  })

  test('falls back to descriptionHtml when plain is absent', async () => {
    mockFetchOnce({ jobs: [{ id: 'j2', title: 'SRE', descriptionHtml: '<p>HTML <b>JD</b></p>' }] })
    const jobs = await fetchAshby({ provider: 'ashby', token: 'acme', company: 'Acme' })
    expect(jobs[0]?.jdText).toBe('HTML JD')
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'
import type { MatchableJob } from '@/lib/roleDiscovery/prefilter'

const state = vi.hoisted(() => ({
  pool: [] as MatchableJob[],
  parsed: { roles: [] as Array<{ id: string; score: number; reason: string }> },
  parseCalls: 0,
  lastContent: '' as string,
  lastArgs: null as null | { model: string; output_config?: { effort?: string } },
}))

vi.mock('./jobStore', () => ({
  listJobsForMatch: vi.fn(async () => state.pool),
  JobStoreError: class extends Error {},
}))

vi.mock('@/lib/anthropic', () => ({
  MODELS: { screen: 'claude-haiku-4-5', score: 'claude-sonnet-5' },
  readParsed: (message: { parsed_output: unknown }) => message.parsed_output,
  logModelUsage: vi.fn(),
  anthropic: {
    messages: {
      parse: vi.fn(async (args: { model: string; output_config?: { effort?: string }; messages: Array<{ content: string }> }) => {
        state.parseCalls++
        state.lastContent = args.messages[0]?.content ?? ''
        state.lastArgs = { model: args.model, output_config: args.output_config }
        return { parsed_output: state.parsed, stop_reason: 'end_turn' }
      }),
    },
  },
}))

import { discoverRoles } from './discoverRoles'

const PROFILE: Profile = {
  name: 'Jordan',
  summary: 'Cloud engineer',
  skills: ['Azure', 'VMware'],
  certs: [],
  roles: [{ company: 'Acme', title: 'Cloud Engineer', startDate: '2022', endDate: null, bullets: [] }],
  education: [],
}

function job(id: string, title: string, snippet = ''): MatchableJob {
  return { id, provider: 'lever', title, company: 'Co', location: null, url: `u/${id}`, snippet }
}

afterEach(() => {
  state.pool = []
  state.parsed = { roles: [] }
  state.parseCalls = 0
  state.lastContent = ''
  state.lastArgs = null
})

describe('discoverRoles', () => {
  test('returns [] and makes NO model call when nothing lexically overlaps', async () => {
    state.pool = [job('a', 'Barista'), job('b', 'Line Cook')]
    const out = await discoverRoles(PROFILE)
    expect(out).toEqual([])
    expect(state.parseCalls).toBe(0) // pre-filter short-circuits before the paid rerank
  })

  test('re-ranks the lexically-overlapping shortlist and returns assembled roles', async () => {
    state.pool = [job('a', 'Azure Platform Engineer', 'vmware'), job('b', 'Barista')]
    state.parsed = { roles: [{ id: 'a', score: 88, reason: 'same Azure/VMware work' }] }
    const out = await discoverRoles(PROFILE)
    expect(state.parseCalls).toBe(1)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', score: 88, title: 'Azure Platform Engineer', reason: 'same Azure/VMware work' })
  })

  test('passes only the SET preferences into the rerank prompt', async () => {
    state.pool = [job('a', 'Azure Platform Engineer', 'vmware')]
    state.parsed = { roles: [{ id: 'a', score: 80, reason: 'fit' }] }
    await discoverRoles(PROFILE, {
      targetCompTopUsd: 175000,
      targetLanes: ['Cloud Engineer'],
      noGoLocations: ['California'],
      workModes: ['remote'],
      employmentTypes: ['contract'],
    })
    expect(state.lastContent).toContain('<preferences>')
    expect(state.lastContent).toContain('175000')
    expect(state.lastContent).toContain('California')
    expect(state.lastContent).toContain('remote')
    expect(state.lastContent).toContain('contract')
    // employerTypePreference wasn't set, so it must not appear in the block
    expect(state.lastContent).not.toContain('employerTypePreference')
  })

  test('sends an empty preferences block when none are set (pure-similarity ranking)', async () => {
    state.pool = [job('a', 'Azure Platform Engineer', 'vmware')]
    state.parsed = { roles: [{ id: 'a', score: 80, reason: 'fit' }] }
    await discoverRoles(PROFILE)
    expect(state.lastContent).toContain('<preferences>{}</preferences>')
  })

  test('excludes clearly-non-US postings before ranking (US-only default)', async () => {
    state.pool = [
      { ...job('us', 'Azure Platform Engineer', 'vmware'), location: 'Austin, TX' },
      { ...job('intl', 'Azure Platform Engineer', 'vmware'), location: 'Tokyo, Japan' },
    ]
    state.parsed = { roles: [{ id: 'us', score: 80, reason: 'fit' }] }
    await discoverRoles(PROFILE)
    expect(state.lastContent).toContain('"id":"us"')
    expect(state.lastContent).not.toContain('"id":"intl"')
  })

  test('production rerank runs on Haiku (MODELS.screen) with NO effort tier (no eval-less model swap)', async () => {
    state.pool = [job('a', 'Azure Platform Engineer', 'vmware')]
    state.parsed = { roles: [{ id: 'a', score: 80, reason: 'fit' }] }
    await discoverRoles(PROFILE)
    // Locks the evidence-gated decision: the model stays Haiku and no effort tier is sent until the
    // manual eval justifies a swap. If a future change moves this to Sonnet 5, update the eval + this.
    expect(state.lastArgs?.model).toBe('claude-haiku-4-5')
    expect(state.lastArgs?.output_config?.effort).toBeUndefined()
  })

  test('rerankRoles honors a model + effort override (the path the manual eval drives)', async () => {
    const { rerankRoles } = await import('./discoverRoles')
    state.parsed = { roles: [{ id: 'a', score: 90, reason: 'fit' }] }
    const candidates = [{ id: 'a', title: 'Platform Engineer', company: 'Co', location: null, snippet: 'azure vmware' }]
    const ranked = await rerankRoles(PROFILE, undefined, candidates, { model: 'claude-sonnet-5', effort: 'low' })
    expect(ranked.roles[0]).toMatchObject({ id: 'a', score: 90 })
    expect(state.lastArgs?.model).toBe('claude-sonnet-5')
    expect(state.lastArgs?.output_config?.effort).toBe('low')
  })

  test('tags a failing step via DiscoverError', async () => {
    state.pool = [job('a', 'Azure Engineer', 'vmware')]
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.parse).mockRejectedValueOnce(new Error('model down'))
    await expect(discoverRoles(PROFILE)).rejects.toMatchObject({ name: 'DiscoverError', step: 'rerank' })
  })
})

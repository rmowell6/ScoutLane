import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'
import type { MatchableJob } from '@/lib/roleDiscovery/prefilter'

const state = vi.hoisted(() => ({
  pool: [] as MatchableJob[],
  parsed: { roles: [] as Array<{ id: string; score: number; reason: string }> },
  parseCalls: 0,
}))

vi.mock('./jobStore', () => ({
  listJobsForMatch: vi.fn(async () => state.pool),
  JobStoreError: class extends Error {},
}))

vi.mock('@/lib/anthropic', () => ({
  MODELS: { screen: 'claude-haiku-4-5' },
  anthropic: {
    messages: {
      parse: vi.fn(async () => {
        state.parseCalls++
        return { parsed_output: state.parsed }
      }),
    },
  },
}))

import { discoverRoles } from './discoverRoles'

const PROFILE: Profile = {
  name: 'Ryan',
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

  test('tags a failing step via DiscoverError', async () => {
    state.pool = [job('a', 'Azure Engineer', 'vmware')]
    const { anthropic } = await import('@/lib/anthropic')
    vi.mocked(anthropic.messages.parse).mockRejectedValueOnce(new Error('model down'))
    await expect(discoverRoles(PROFILE)).rejects.toMatchObject({ name: 'DiscoverError', step: 'rerank' })
  })
})

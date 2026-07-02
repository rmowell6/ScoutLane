import { describe, expect, test, vi } from 'vitest'
import type { Profile } from '@/lib/schemas'

// Mock the Anthropic layer the same way discoverRoles.test.ts does: a stub parse that returns a
// valid Profile, readParsed as a passthrough, and logModelUsage as a spy so we can assert the call
// fires (structureResume previously did NOT log usage, so this pins that it now does, consistently
// with extractFitInput/tailorResume per PR #175).
const state = vi.hoisted(() => ({
  message: null as unknown,
  lastArgs: null as null | { model: string; max_tokens: number },
}))

vi.mock('@/lib/anthropic', () => ({
  MODELS: { screen: 'claude-haiku-4-5', score: 'claude-sonnet-5', tailor: 'claude-sonnet-5' },
  readParsed: (message: { parsed_output: unknown }) => message.parsed_output,
  logModelUsage: vi.fn(),
  anthropic: {
    messages: {
      parse: vi.fn(async (args: { model: string; max_tokens: number }) => {
        state.lastArgs = { model: args.model, max_tokens: args.max_tokens }
        return state.message
      }),
    },
  },
}))

import { structureResume } from './structureResume'
import { anthropic, logModelUsage } from '@/lib/anthropic'

const PROFILE: Profile = {
  name: 'Jordan Rivera',
  summary: 'Cloud engineer.',
  skills: ['Azure'],
  certs: [],
  roles: [{ company: 'Acme', title: 'Cloud Engineer', startDate: '2022', endDate: null, bullets: ['Ran Azure'] }],
  education: [],
}

describe('structureResume', () => {
  test('logs per-call usage (label + message) so the Haiku call has token visibility', async () => {
    const message = { parsed_output: PROFILE, stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 700 } }
    state.message = message

    const profile = await structureResume('Jordan Rivera\nCloud Engineer at Acme')

    expect(profile).toEqual(PROFILE)
    expect(anthropic.messages.parse).toHaveBeenCalledTimes(1)
    // The usage logger is wired for this call, with the correct step label and the raw SDK message.
    expect(logModelUsage).toHaveBeenCalledWith('structureResume', message)
  })
})

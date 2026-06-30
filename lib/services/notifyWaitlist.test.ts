import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Records the commands handed to SESv2Client.send across the suite, and lets a test force a failure.
const sent = vi.hoisted(() => ({ commands: [] as unknown[], throwOnSend: false }))

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    async send(cmd: unknown) {
      if (sent.throwOnSend) throw new Error('SES rejected')
      sent.commands.push(cmd)
      return { MessageId: 'test-id' }
    }
  },
  // The route builds a SendEmailCommand; capture its input verbatim so we can assert on it.
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
}))

const ENV = { AWS_REGION: 'us-east-1', WAITLIST_NOTIFY_FROM: 'notify@scoutlane.app', WAITLIST_NOTIFY_TO: 'admin@x.com' }

// The module captures env into consts at import time, so each test sets env then re-imports fresh.
async function load(env: Partial<typeof ENV>) {
  vi.resetModules()
  for (const k of Object.keys(ENV) as (keyof typeof ENV)[]) delete process.env[k]
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  return import('./notifyWaitlist')
}

beforeEach(() => {
  sent.commands = []
  sent.throwOnSend = false
})
afterEach(() => {
  for (const k of Object.keys(ENV) as (keyof typeof ENV)[]) delete process.env[k]
})

describe('notifyWaitlistSignup', () => {
  test('is a no-op (returns false, no send) when SES env is absent', async () => {
    const { notifyWaitlistSignup, isWaitlistNotifyConfigured } = await load({})
    expect(isWaitlistNotifyConfigured()).toBe(false)
    expect(await notifyWaitlistSignup({ email: 'a@b.com' })).toBe(false)
    expect(sent.commands).toHaveLength(0)
  })

  test('sends a plain-text email to the configured admin when fully configured', async () => {
    const { notifyWaitlistSignup, isWaitlistNotifyConfigured } = await load(ENV)
    expect(isWaitlistNotifyConfigured()).toBe(true)
    expect(await notifyWaitlistSignup({ email: 'p@x.com', note: 'building stuff', source: 'landing' })).toBe(true)
    expect(sent.commands).toHaveLength(1)
    const input = (sent.commands[0] as { input: Record<string, unknown> }).input
    expect(input.FromEmailAddress).toBe(ENV.WAITLIST_NOTIFY_FROM)
    expect(input.Destination).toEqual({ ToAddresses: [ENV.WAITLIST_NOTIFY_TO] })
    const body = JSON.stringify(input.Content)
    expect(body).toContain('p@x.com')
    expect(body).toContain('building stuff')
  })

  test('swallows SES errors and returns false (a delivery failure never throws)', async () => {
    sent.throwOnSend = true
    const { notifyWaitlistSignup } = await load(ENV)
    await expect(notifyWaitlistSignup({ email: 'p@x.com' })).resolves.toBe(false)
  })
})

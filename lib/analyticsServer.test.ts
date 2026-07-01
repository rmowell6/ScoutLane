import { afterEach, describe, expect, test, vi } from 'vitest'
import { captureServer, serverAnalyticsEnabled, SERVER_EVENTS } from '@/lib/analyticsServer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('captureServer (server-side PostHog)', () => {
  test('is a no-op with no key configured (never touches the network)', async () => {
    vi.stubEnv('POSTHOG_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(serverAnalyticsEnabled()).toBe(false)
    await captureServer(SERVER_EVENTS.packetBlocked, 'user-1', { unverifiable_count: 2 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('POSTs a well-formed capture payload when a key is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com')
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(serverAnalyticsEnabled()).toBe(true)
    await captureServer(SERVER_EVENTS.packetBlocked, 'user-1', { looks_like_aggregate: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://us.i.posthog.com/capture/')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.api_key).toBe('phc_test')
    expect(body.event).toBe('packet_blocked')
    expect(body.distinct_id).toBe('user-1')
    expect(body.properties.looks_like_aggregate).toBe(true)
    expect(body.properties.$lib).toBe('scoutlane-server')
  })

  test('swallows a network error (never throws, so it cannot break the response)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    await expect(captureServer(SERVER_EVENTS.packetBlocked, 'user-1', {})).resolves.toBeUndefined()
  })
})

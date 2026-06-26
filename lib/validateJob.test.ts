import { describe, expect, test } from 'vitest'
import { classifyJobStatus, isValidHttpUrl, validateJobUrl } from '@/lib/validateJob'

describe('classifyJobStatus', () => {
  test('200-class is live', () => {
    expect(classifyJobStatus(200)).toBe('live')
    expect(classifyJobStatus(204)).toBe('live')
  })
  test('404/410 are expired', () => {
    expect(classifyJobStatus(404)).toBe('expired')
    expect(classifyJobStatus(410)).toBe('expired')
  })
  test('other codes are unverified', () => {
    expect(classifyJobStatus(500)).toBe('unverified')
    expect(classifyJobStatus(403)).toBe('unverified')
  })
})

describe('isValidHttpUrl', () => {
  test('accepts http(s)', () => {
    expect(isValidHttpUrl('https://boards.example.com/jobs/1')).toBe(true)
  })
  test('rejects junk and non-http schemes', () => {
    expect(isValidHttpUrl('not a url')).toBe(false)
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
  })
})

describe('validateJobUrl', () => {
  const fakeRes = (status: number, url = 'https://x.test/final') =>
    ({ status, url }) as unknown as Response

  test('returns unverified for an invalid URL without fetching', async () => {
    let called = false
    const result = await validateJobUrl('nope', {
      fetchImpl: async () => {
        called = true
        return fakeRes(200)
      },
    })
    expect(result.status).toBe('unverified')
    expect(called).toBe(false)
  })

  test('maps a 200 to live and surfaces the final URL', async () => {
    const result = await validateJobUrl('https://x.test/job', {
      fetchImpl: async () => fakeRes(200, 'https://x.test/job-final'),
    })
    expect(result.status).toBe('live')
    expect(result.finalUrl).toBe('https://x.test/job-final')
    expect(result.httpStatus).toBe(200)
  })

  test('maps a 404 to expired', async () => {
    const result = await validateJobUrl('https://x.test/gone', { fetchImpl: async () => fakeRes(404) })
    expect(result.status).toBe('expired')
  })

  test('treats a fetch error as unverified', async () => {
    const result = await validateJobUrl('https://x.test/boom', {
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    expect(result.status).toBe('unverified')
  })
})

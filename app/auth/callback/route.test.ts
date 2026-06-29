import { describe, expect, test } from 'vitest'
import { safeNext } from './route'

const ORIGIN = 'https://scoutlane.app'

describe('safeNext (open-redirect defense, B1-7)', () => {
  test('keeps a same-origin relative path', () => {
    expect(safeNext('/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeNext('/jobs?q=eng#top', ORIGIN)).toBe('/jobs?q=eng#top')
  })

  test('defaults to the app home for null/empty', () => {
    expect(safeNext(null, ORIGIN)).toBe('/app')
    expect(safeNext('', ORIGIN)).toBe('/app')
  })

  test('rejects protocol-relative and backslash-smuggled hosts (the naive-check bypasses)', () => {
    expect(safeNext('//evil.com', ORIGIN)).toBe('/app')
    expect(safeNext('/\\evil.com', ORIGIN)).toBe('/app')
    expect(safeNext('/%2F%2Fevil.com', ORIGIN)).toBe('/%2F%2Fevil.com') // stays a path on our origin, harmless
  })

  test('rejects absolute cross-origin URLs (falls back to the app home)', () => {
    expect(safeNext('https://evil.com/phish', ORIGIN)).toBe('/app')
    expect(safeNext('http://evil.com', ORIGIN)).toBe('/app')
    expect(safeNext('javascript:alert(1)', ORIGIN)).toBe('/app')
  })

  test('strips an absolute same-origin URL down to its path (caller never gets an absolute URL)', () => {
    expect(safeNext(`${ORIGIN}/settings`, ORIGIN)).toBe('/settings')
  })
})

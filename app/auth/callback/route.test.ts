import { describe, expect, test } from 'vitest'
import { safeNext } from './route'

const ORIGIN = 'https://scoutlane.app'

describe('safeNext (open-redirect defense, B1-7)', () => {
  test('keeps a same-origin relative path', () => {
    expect(safeNext('/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeNext('/jobs?q=eng#top', ORIGIN)).toBe('/jobs?q=eng#top')
  })

  test('defaults to "/" for null/empty', () => {
    expect(safeNext(null, ORIGIN)).toBe('/')
    expect(safeNext('', ORIGIN)).toBe('/')
  })

  test('rejects protocol-relative and backslash-smuggled hosts (the naive-check bypasses)', () => {
    expect(safeNext('//evil.com', ORIGIN)).toBe('/')
    expect(safeNext('/\\evil.com', ORIGIN)).toBe('/')
    expect(safeNext('/%2F%2Fevil.com', ORIGIN)).toBe('/%2F%2Fevil.com') // stays a path on our origin, harmless
  })

  test('rejects absolute cross-origin URLs', () => {
    expect(safeNext('https://evil.com/phish', ORIGIN)).toBe('/')
    expect(safeNext('http://evil.com', ORIGIN)).toBe('/')
    expect(safeNext('javascript:alert(1)', ORIGIN)).toBe('/')
  })

  test('strips an absolute same-origin URL down to its path (caller never gets an absolute URL)', () => {
    expect(safeNext(`${ORIGIN}/settings`, ORIGIN)).toBe('/settings')
  })
})

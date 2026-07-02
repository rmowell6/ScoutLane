import { afterEach, describe, expect, test, vi } from 'vitest'
import { expiredEntryNames, isBucketNotFoundError, logStorageDegraded } from './storage'

const HOUR = 60 * 60 * 1000

describe('expiredEntryNames', () => {
  // cutoff = "anything created before this instant is expired"
  const now = new Date('2026-06-28T12:00:00Z').getTime()
  const cutoff = now - 24 * HOUR // 2026-06-27T12:00:00Z

  test('returns names of entries created before the cutoff', () => {
    const entries = [
      { name: 'old.docx', created_at: '2026-06-26T00:00:00Z' }, // older than cutoff
      { name: 'fresh.docx', created_at: '2026-06-28T11:00:00Z' }, // within a day
    ]
    expect(expiredEntryNames(entries, cutoff)).toEqual(['old.docx'])
  })

  test('falls back to updated_at when created_at is absent', () => {
    const entries = [{ name: 'a.docx', updated_at: '2026-06-25T00:00:00Z' }]
    expect(expiredEntryNames(entries, cutoff)).toEqual(['a.docx'])
  })

  test('leaves an entry with NO timestamp alone (never guessed-stale)', () => {
    const entries = [{ name: 'mystery.docx' }]
    expect(expiredEntryNames(entries, cutoff)).toEqual([])
  })

  test('treats a null created_at as absent and uses updated_at', () => {
    const entries = [{ name: 'b.docx', created_at: null, updated_at: '2026-06-20T00:00:00Z' }]
    expect(expiredEntryNames(entries, cutoff)).toEqual(['b.docx'])
  })

  test('does not expire a boundary-fresh entry created exactly at the cutoff', () => {
    const entries = [{ name: 'edge.docx', created_at: new Date(cutoff).toISOString() }]
    expect(expiredEntryNames(entries, cutoff)).toEqual([]) // strict < cutoff
  })
})

describe('isBucketNotFoundError', () => {
  test('detects the "Bucket not found" misconfiguration from an Error or a plain object', () => {
    // Supabase raises a StorageApiError (an Error subclass) with this exact message.
    expect(isBucketNotFoundError(new Error('Bucket not found'))).toBe(true)
    expect(isBucketNotFoundError({ name: 'StorageApiError', message: 'Bucket not found', status: 400 })).toBe(true)
    expect(isBucketNotFoundError(new Error('bucket NOT FOUND'))).toBe(true) // case-insensitive
  })

  test('does NOT classify a transient/other error as a missing bucket', () => {
    expect(isBucketNotFoundError(new Error('fetch failed'))).toBe(false)
    expect(isBucketNotFoundError(new Error('Payload too large'))).toBe(false)
    expect(isBucketNotFoundError(null)).toBe(false)
  })
})

describe('logStorageDegraded', () => {
  afterEach(() => vi.restoreAllMocks())

  const capture = (err: unknown): string => {
    let line = ''
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => {
      line = String(m)
    })
    logStorageDegraded(err)
    return line
  }

  test('a missing bucket logs a loud MISCONFIGURED message naming the bucket and the exact fix', () => {
    const line = capture(new Error('Bucket not found'))
    expect(line).toContain('STORAGE MISCONFIGURED')
    expect(line).toContain('"documents"') // the exact bucket to create
    expect(line).toContain('Storage > New bucket') // the exact dashboard step
    expect(line).toContain('inline base64')
  })

  test('a transient/other upload error logs the DEGRADED (inline fallback) message', () => {
    const line = capture(new Error('fetch failed'))
    expect(line).toContain('STORAGE DEGRADED')
    expect(line).toContain('inline')
    expect(line).not.toContain('STORAGE MISCONFIGURED')
  })
})

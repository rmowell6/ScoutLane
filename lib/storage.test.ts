import { describe, expect, test } from 'vitest'
import { expiredEntryNames } from './storage'

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

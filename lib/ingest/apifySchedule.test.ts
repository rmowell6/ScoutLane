import { describe, expect, test } from 'vitest'
import { apifyDays, isApifyDay, APIFY_DAYS_DEFAULT } from './apifySchedule'

describe('apifyDays', () => {
  test('defaults to 1/11/21 when APIFY_INGEST_DAYS is unset', () => {
    expect(apifyDays({})).toEqual([...APIFY_DAYS_DEFAULT])
  })

  test('parses a comma-separated override, trimming whitespace', () => {
    expect(apifyDays({ APIFY_INGEST_DAYS: '1, 8 ,15,22' })).toEqual([1, 8, 15, 22])
  })

  test('drops out-of-range and non-integer entries', () => {
    expect(apifyDays({ APIFY_INGEST_DAYS: '0,5,32,abc,15.5,21' })).toEqual([5, 21])
  })

  test('falls back to the default when the override has no valid days', () => {
    expect(apifyDays({ APIFY_INGEST_DAYS: '0,99,foo' })).toEqual([...APIFY_DAYS_DEFAULT])
  })
})

describe('isApifyDay', () => {
  test('true on a default Apify day (UTC), false otherwise', () => {
    expect(isApifyDay('2026-06-11T03:00:00.000Z', {})).toBe(true)
    expect(isApifyDay('2026-06-12T03:00:00.000Z', {})).toBe(false)
  })

  test('uses UTC, not local time, for the day-of-month boundary', () => {
    // 2026-06-21T01:00Z is still the 20th in US time zones — must still read as the 21st (UTC).
    expect(isApifyDay('2026-06-21T01:00:00.000Z', {})).toBe(true)
  })

  test('honors a custom day list', () => {
    const env = { APIFY_INGEST_DAYS: '15' }
    expect(isApifyDay('2026-06-15T03:00:00.000Z', env)).toBe(true)
    expect(isApifyDay('2026-06-11T03:00:00.000Z', env)).toBe(false)
  })

  // cloud-13: the cron fires at 03:00 UTC and gating is UTC-based, so the day boundary is consistent.
  // The 1st (an Apify day) is reached cleanly at a month rollover; the prior month's last day is not.
  test('handles month boundaries at the cron hour (03:00 UTC)', () => {
    expect(isApifyDay('2026-07-01T03:00:00.000Z', {})).toBe(true) // 1st of July = Apify day
    expect(isApifyDay('2026-06-30T03:00:00.000Z', {})).toBe(false) // 30th = not an Apify day
    expect(isApifyDay('2026-03-01T03:00:00.000Z', {})).toBe(true) // day after Feb's last day
    expect(isApifyDay('2026-02-28T03:00:00.000Z', {})).toBe(false) // Feb 28 (last day, non-leap)
    expect(isApifyDay('2026-12-31T03:00:00.000Z', {})).toBe(false) // year-end, day 31, not gated
  })
})

import { describe, expect, test } from 'vitest'
import { isUsLocation } from './usLocation'

describe('isUsLocation', () => {
  test('keeps explicit US locations', () => {
    for (const loc of [
      'US Remote',
      'Remote - US',
      'United States',
      'Seattle, WA',
      'San Francisco',
      'New York, NY',
      'Austin, TX',
      'California',
      'Remote (US)',
    ]) {
      expect(isUsLocation(loc), loc).toBe(true)
    }
  })

  test('drops clearly non-US locations', () => {
    for (const loc of [
      'Sydney, Australia',
      'Singapore',
      'Tokyo, Japan',
      'London, UK',
      'Bengaluru, India',
      'Toronto, Canada',
      'Remote - EMEA',
      'Dublin',
      'Berlin, Germany',
    ]) {
      expect(isUsLocation(loc), loc).toBe(false)
    }
  })

  test('keeps unknown / generic-remote (bias toward inclusion)', () => {
    for (const loc of [null, undefined, '', '   ', 'Remote', 'Anywhere']) {
      expect(isUsLocation(loc), String(loc)).toBe(true)
    }
  })

  test('a US signal wins even when a non-US place is also mentioned', () => {
    expect(isUsLocation('San Francisco or London')).toBe(true)
    expect(isUsLocation('Dublin, Ohio')).toBe(true) // Ohio (US) wins over Dublin (Ireland)
  })
})

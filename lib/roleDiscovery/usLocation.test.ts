import { describe, expect, test } from 'vitest'
import { isUsLocation, isUsRole } from './usLocation'

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
      // German cities the metro list had missed (the "SAP FICO Consultant - Hamburg" leak).
      'Hamburg',
      'Stuttgart',
      'Köln',
      // Canadian provinces named without the country (the "Guard - British Columbia" leak).
      'British Columbia',
      'British Columbia,',
      'Vancouver, British Columbia',
      'Alberta',
      'Saskatchewan',
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

  test('treats garbled (mojibake) accented locations as non-US', () => {
    // "Gijón ... España" arriving as UTF-8 mis-decoded as Latin-1 (the real feed value).
    expect(isUsLocation('Gijã³n, Principado de Asturias, Espaã±a')).toBe(false)
  })

  test('treats non-Latin (Arabic/Cyrillic) mojibake as non-US, not just accented Latin', () => {
    // The feed leak: a UTF-8 location read as Latin-1. Reproduce it from the real bytes so the test
    // can't drift. Arabic/Cyrillic lead bytes (0xD8/0xD0) sit past the old 0xC2/0xC3 class, so these
    // used to slip through and render as garbled text in the feed.
    const misdecode = (s: string) => Buffer.from(s, 'utf8').toString('latin1')
    expect(isUsLocation(misdecode('دبي، الإمارات')), 'Arabic (Dubai)').toBe(false)
    expect(isUsLocation(misdecode('Москва, Россия')), 'Cyrillic (Moscow)').toBe(false)
  })

  test('drops native-language / smaller-EU place names the metro list missed', () => {
    for (const loc of ['Asturias', 'Heinsberg', 'Aachen', 'Pirmasens', 'Madrid, España']) {
      expect(isUsLocation(loc), loc).toBe(false)
    }
  })
})

describe('isUsRole (location + company + title)', () => {
  test('drops a role with a European company legal form, even with a small-town/remote location', () => {
    expect(isUsRole({ location: 'Heinsberg', company: 'sera Werke J. Ravnak GmbH & Co.KG', title: 'Finance' })).toBe(false)
    expect(isUsRole({ location: 'Remote', company: 'Acme S.L.', title: 'Developer' })).toBe(false)
  })

  test('drops a role with a (m/w/d)-style gender tag in the title', () => {
    expect(isUsRole({ location: 'Remote', company: 'Acme', title: 'Teamleitung Finance (m/w/d)' })).toBe(false)
    expect(isUsRole({ location: 'Remote', company: 'Acme', title: 'Engineer (m/f/d)' })).toBe(false)
  })

  test('drops the feed rows that leaked: Hamburg, British Columbia, garbled location', () => {
    const misdecode = (s: string) => Buffer.from(s, 'utf8').toString('latin1')
    expect(isUsRole({ location: 'Hamburg', company: 'Pertemps ERP', title: 'SAP FICO Consultant' })).toBe(false)
    expect(isUsRole({ location: 'British Columbia,', company: 'Township of Langley', title: 'Guard' })).toBe(false)
    expect(
      isUsRole({ location: misdecode('دبي، الإمارات'), company: 'CXC Upstream Ltd', title: 'Operations Manager' }),
    ).toBe(false)
  })

  test('keeps clean US roles (incl. WPAFB / Greene County)', () => {
    expect(isUsRole({ location: 'Austin, TX', company: 'Acme Inc', title: 'Platform Engineer' })).toBe(true)
    expect(isUsRole({ location: 'Wpafb, Greene County', company: 'ManTech International', title: 'IT Project Lead' })).toBe(true)
  })

  test('falls back to location with bias toward keeping when no marker is present', () => {
    expect(isUsRole({ location: 'Remote', company: 'Acme', title: 'Engineer' })).toBe(true)
    expect(isUsRole({ location: null, company: null, title: null })).toBe(true)
  })
})

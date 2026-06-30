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

  test('keeps clean US roles (incl. WPAFB / Greene County)', () => {
    expect(isUsRole({ location: 'Austin, TX', company: 'Acme Inc', title: 'Platform Engineer' })).toBe(true)
    expect(isUsRole({ location: 'Wpafb, Greene County', company: 'ManTech International', title: 'IT Project Lead' })).toBe(true)
  })

  test('falls back to location with bias toward keeping when no marker is present', () => {
    expect(isUsRole({ location: 'Remote', company: 'Acme', title: 'Engineer' })).toBe(true)
    expect(isUsRole({ location: null, company: null, title: null })).toBe(true)
  })
})

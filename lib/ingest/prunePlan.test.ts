import { describe, expect, test } from 'vitest'
import { prunableAtsProviders, prunableBoardSources } from './prunePlan'

describe('prunableAtsProviders', () => {
  test('includes a provider only when ALL its sources succeeded this run', () => {
    const sources = [
      { provider: 'greenhouse', ok: true },
      { provider: 'greenhouse', ok: true },
      { provider: 'lever', ok: true },
      { provider: 'ashby', ok: false }, // ashby had a failure
    ]
    expect(prunableAtsProviders(sources).sort()).toEqual(['greenhouse', 'lever'])
  })

  test('excludes a provider if ANY of its sources failed (one bad company shields the whole provider)', () => {
    const sources = [
      { provider: 'greenhouse', ok: true },
      { provider: 'greenhouse', ok: false }, // one greenhouse company 404'd
    ]
    expect(prunableAtsProviders(sources)).toEqual([])
  })

  test('returns nothing for an empty result set (whole ATS leg rejected → prune nothing)', () => {
    expect(prunableAtsProviders([])).toEqual([])
  })
})

describe('prunableBoardSources', () => {
  test('includes only sources that returned without error', () => {
    const sources = [
      { name: 'arbeitnow' },
      { name: 'remoteok', error: 'Timed out after 60000ms' },
      { name: 'jsearch' },
    ]
    expect(prunableBoardSources(sources).sort()).toEqual(['arbeitnow', 'jsearch'])
  })

  test('returns nothing for an empty source list (whole boards leg rejected → prune nothing)', () => {
    expect(prunableBoardSources([])).toEqual([])
  })
})

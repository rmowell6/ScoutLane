import { describe, expect, test } from 'vitest'
import { inferStyleInput } from './inferStyleInput'

describe('inferStyleInput', () => {
  test('passes through valid signals', () => {
    expect(inferStyleInput({ domain: 'insurance', seniority: 'senior', roleType: 'security' })).toEqual({
      domain: 'insurance',
      seniority: 'senior',
      roleType: 'security',
    })
  })

  test('drops out-of-vocab enums to undefined (recommend falls back cleanly)', () => {
    expect(inferStyleInput({ domain: 'fintech', seniority: 'ninja', roleType: 'rockstar' })).toEqual({
      domain: 'fintech',
      seniority: undefined,
      roleType: undefined,
    })
  })

  test('nulls and blanks become undefined', () => {
    expect(inferStyleInput({ domain: null, seniority: null, roleType: null })).toEqual({
      domain: undefined,
      seniority: undefined,
      roleType: undefined,
    })
    expect(inferStyleInput({ domain: '   ' })).toEqual({
      domain: undefined,
      seniority: undefined,
      roleType: undefined,
    })
  })

  test('empty classification yields an all-undefined input', () => {
    expect(inferStyleInput({})).toEqual({ domain: undefined, seniority: undefined, roleType: undefined })
  })
})

import { describe, expect, test } from 'vitest'
import { parseCsv, parseCsvObjects } from './csv'

describe('parseCsv', () => {
  test('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  test('handles quoted fields with embedded commas and escaped quotes', () => {
    expect(parseCsv('name,note\n"Smith, John","a ""quoted"" bit"\n')).toEqual([
      ['name', 'note'],
      ['Smith, John', 'a "quoted" bit'],
    ])
  })

  test('handles CRLF line endings and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseCsvObjects', () => {
  test('keys rows by header and drops blank trailing lines', () => {
    const rows = parseCsvObjects('Workplace Example,Element Name\nExact Software Macola ES,ERP software\n\n')
    expect(rows).toEqual([{ 'Workplace Example': 'Exact Software Macola ES', 'Element Name': 'ERP software' }])
  })
})

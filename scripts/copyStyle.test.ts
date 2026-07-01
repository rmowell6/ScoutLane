import { describe, expect, test } from 'vitest'
import { scanText, stripComments } from './copyStyle'

describe('scanText (copy-style scanner)', () => {
  test('catches an em dash and reports its 1-indexed line', () => {
    const found = scanText('clean line\ncontains an — em dash\nalso clean')
    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(2)
    expect(found[0]?.violations.join()).toMatch(/em dash/)
  })

  test('catches repeated spaces INSIDE the copy', () => {
    const found = scanText('a normal line\ntwo  spaces here')
    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(2)
    expect(found[0]?.violations.join()).toMatch(/repeated spaces/)
  })

  test('does NOT flag leading indentation (JSX/TSX source indent is not a copy violation)', () => {
    // Six-space indent then clean single-spaced content, the shape of real .tsx source.
    expect(scanText('      <p>Clean single spaced copy.</p>')).toEqual([])
  })

  test('passes clean text', () => {
    expect(scanText('Request access. No fabrication, enforced in code.\nJust the facts.')).toEqual([])
  })

  test('does NOT flag repeated spaces inside a code comment (alignment is not copy)', () => {
    // Both a // line comment and a block comment with aligned runs of spaces.
    const src = ['// step 1  (aligned)', '/*  aligned block  */', 'const x = 1'].join('\n')
    expect(scanText(src)).toEqual([])
  })

  test('still flags an em dash even when it hides in a comment (house style forbids it everywhere)', () => {
    const found = scanText('// a comment with an — em dash')
    expect(found).toHaveLength(1)
    expect(found[0]?.violations.join()).toMatch(/em dash/)
  })

  test('stripComments preserves a // inside a string (URL), so real copy after it is still scanned', () => {
    // The // in https:// must not be treated as a comment; the double space after stays visible.
    const [stripped] = stripComments('const u = "https://x.com  y"')
    expect(stripped).toContain('https://x.com  y')
  })
})

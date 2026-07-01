import { describe, expect, test } from 'vitest'
import { deEmDash, tidyLine, tidyParagraphs } from './tailorResume'

// Regression: Sonnet 5 emits em dashes despite the prompt, and a single stray ", " in any shipped
// field trips checkStyle and blocks the whole packet. The tidy step now strips them deterministically.
describe('em-dash sanitization (deEmDash + tidy)', () => {
  test('replaces a spaced em dash with a comma', () => {
    expect(deEmDash('the scale — the expertise')).toBe('the scale, the expertise')
  })

  test('replaces an unspaced em dash', () => {
    expect(deEmDash('services—virtual machines')).toBe('services, virtual machines')
  })

  test('handles a parenthetical em-dash pair', () => {
    expect(deEmDash('Azure services — VMs, storage — aligned with HIPAA')).toBe(
      'Azure services, VMs, storage, aligned with HIPAA',
    )
  })

  test('tidyLine output never contains an em dash', () => {
    const out = tidyLine('Owned Azure  —  on-prem operations — end to end')
    expect(out).not.toContain('—')
    expect(out).not.toMatch(/ {2,}/)
  })

  test('tidyParagraphs strips em dashes but preserves blank-line paragraph breaks', () => {
    const out = tidyParagraphs('First para — with a clause.\n\nSecond para — and another.')
    expect(out).not.toContain('—')
    expect(out).toBe('First para, with a clause.\n\nSecond para, and another.')
  })

  test('does not touch ordinary hyphens or text without em dashes', () => {
    expect(deEmDash('on-prem, end-to-end, NIST 800-53')).toBe('on-prem, end-to-end, NIST 800-53')
  })
})

import { describe, expect, test } from 'vitest'
import { previewStyle, THEME_OPTIONS, FONT_OPTIONS } from './skin'

describe('previewStyle', () => {
  test('returns the full palette as hex colors and font stacks for a known pair', () => {
    const s = previewStyle('navy_copper', 'cambria_calibri')
    for (const c of [s.primary, s.accent, s.accentText, s.slate, s.wash]) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    // The real MS font name leads each stack, with a generic family as the final fallback.
    expect(s.headFont).toContain('"Cambria"')
    expect(s.headFont).toMatch(/serif$/)
    expect(s.bodyFont).toContain('"Calibri"')
    expect(s.bodyFont).toMatch(/sans-serif$/)
  })

  test('falls back to the master skin for unknown ids (never throws)', () => {
    const unknown = previewStyle('does_not_exist', 'nope')
    const master = previewStyle('navy_copper', 'cambria_calibri')
    expect(unknown).toEqual(master)
  })

  test('every theme/font option resolves to a valid preview', () => {
    for (const t of THEME_OPTIONS) {
      for (const f of FONT_OPTIONS) {
        const s = previewStyle(t.id, f.id)
        expect(s.primary).toMatch(/^#/)
        expect(s.headFont.length).toBeGreaterThan(0)
        expect(s.bodyFont.length).toBeGreaterThan(0)
      }
    }
  })
})

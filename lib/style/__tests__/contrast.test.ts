/**
 * Contrast test suite, lib/style/__tests__/contrast.test.ts
 *
 * Asserts WCAG contrast requirements for ALL 10 themes:
 *   - accentText ≥ 4.5:1 on white (AA text, used for dates, taglines)
 *   - primary ≥ 4.5:1 on white (AA text, used for name, headings)
 *   - primary ≥ 4.5:1 on wash (AA text, name on the header band)
 *   - accent ≥ 3:1 vs white (graphic threshold, rules, markers, gauge arc)
 *
 * Additionally snapshots the semantic status colors to assert they are
 * unchanged (they must NEVER be modified by theme changes).
 *
 * Run with: vitest (or jest)
 */

import { describe, it, expect } from 'vitest';
import { contrastRatio, relativeLuminance } from '../assessmentAccent';
import { STATUS_COLORS } from '../assessmentAccent';
import themes from '../themes.json';
import type { Theme } from '../types';

const WHITE = 'FFFFFF';
const AA_TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3.0;

const allThemes = themes.themes as Theme[];

// ---------------------------------------------------------------------------
// Per-theme contrast assertions
// ---------------------------------------------------------------------------

describe('Theme contrast — accentText on white ≥ 4.5:1 (AA text)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}: accentText #${theme.accentText} on white`, () => {
      const ratio = contrastRatio(theme.accentText, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_MIN);
    });
  }
});

describe('Theme contrast — primary on white ≥ 4.5:1 (AA text)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}: primary #${theme.primary} on white`, () => {
      const ratio = contrastRatio(theme.primary, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_MIN);
    });
  }
});

describe('Theme contrast — primary on wash ≥ 4.5:1 (AA text — name on header band)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}: primary #${theme.primary} on wash #${theme.wash}`, () => {
      const ratio = contrastRatio(theme.primary, theme.wash);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_MIN);
    });
  }
});

describe('Theme contrast — accent on white ≥ 3:1 (graphic threshold)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}: accent #${theme.accent} on white`, () => {
      const ratio = contrastRatio(theme.accent, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(GRAPHIC_MIN);
    });
  }
});

describe('Theme contrast — slate on white ≥ 4.5:1 (AA text — muted labels)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}: slate #${theme.slate} on white`, () => {
      const ratio = contrastRatio(theme.slate, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// accentText is darker than accent (enforced by token construction)
// ---------------------------------------------------------------------------

describe('accentText luminance ≤ accent luminance (accentText is the darkened version)', () => {
  for (const theme of allThemes) {
    it(`${theme.id}`, () => {
      const accentL = relativeLuminance(theme.accent);
      const accentTextL = relativeLuminance(theme.accentText);
      // accentText should be darker OR equal (some themes are already compliant as-is)
      expect(accentTextL).toBeLessThanOrEqual(accentL + 0.01); // 0.01 tolerance for rounding
    });
  }
});

// ---------------------------------------------------------------------------
// Semantic status color snapshot, must NEVER change
// ---------------------------------------------------------------------------

describe('Semantic status colors — snapshot (must not change)', () => {
  it('pass is exactly #1a7d46', () => {
    expect(STATUS_COLORS.pass).toBe('1a7d46');
  });

  it('warn is exactly #b45309', () => {
    expect(STATUS_COLORS.warn).toBe('b45309');
  });

  it('fail is exactly #c0392b', () => {
    expect(STATUS_COLORS.fail).toBe('c0392b');
  });

  it('info is exactly #2563c9', () => {
    expect(STATUS_COLORS.info).toBe('2563c9');
  });

  it('pass ≥ 4.5:1 on white', () => {
    expect(contrastRatio(STATUS_COLORS.pass, WHITE)).toBeGreaterThanOrEqual(AA_TEXT_MIN);
  });

  it('warn ≥ 3:1 on white (graphic; fails text — warn text is always paired with icon/label)', () => {
    expect(contrastRatio(STATUS_COLORS.warn, WHITE)).toBeGreaterThanOrEqual(GRAPHIC_MIN);
  });

  it('fail ≥ 3:1 on white (graphic; fails text — fail text is always paired with icon/label)', () => {
    expect(contrastRatio(STATUS_COLORS.fail, WHITE)).toBeGreaterThanOrEqual(GRAPHIC_MIN);
  });

  it('info ≥ 4.5:1 on white', () => {
    expect(contrastRatio(STATUS_COLORS.info, WHITE)).toBeGreaterThanOrEqual(AA_TEXT_MIN);
  });
});

// ---------------------------------------------------------------------------
// Token completeness, every theme has all required fields
// ---------------------------------------------------------------------------

describe('Token completeness', () => {
  const required = ['id', 'name', 'primary', 'accent', 'accentText', 'slate', 'wash', 'bestFor'];

  for (const theme of allThemes) {
    it(`${theme.id} has all required fields`, () => {
      for (const field of required) {
        expect(theme).toHaveProperty(field);
      }
    });
  }

  it('exactly one theme is marked master', () => {
    const masters = allThemes.filter((t) => t.master === true);
    expect(masters).toHaveLength(1);
    expect(masters[0]?.id).toBe('navy_copper');
  });

  it('all themes have unique ids', () => {
    const ids = allThemes.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });

  it('all hex colors are 6 characters', () => {
    for (const theme of allThemes) {
      for (const field of ['primary', 'accent', 'accentText', 'slate', 'wash'] as const) {
        expect(theme[field].replace('#', '')).toHaveLength(6);
      }
    }
  });
});

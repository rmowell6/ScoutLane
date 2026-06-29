/**
 * Assessment accent collision tests — lib/style/__tests__/assessmentAccent.test.ts
 *
 * Asserts:
 *   1. steel_crimson and slate_rust fall back to primary (canonical collision cases).
 *   2. oxford_burgundy falls back to primary (burgundy is in the red hue family).
 *   3. Themes with clearly non-status accents do NOT fall back.
 *   4. All 10 themes: resolveAssessmentAccent returns primary or accent (never something else).
 *   5. The fallback color (primary) passes 4.5:1 on white for every theme.
 *   6. RESOLVED_ACCENTS lookup matches individual resolution.
 *
 * Run with: vitest (or jest)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAssessmentAccent,
  resolveAssessmentAccentById,
  RESOLVED_ACCENTS,
  checkCollision,
  contrastRatio,
  hexToHsv,
  hueDist,
  STATUS_COLORS,
} from '../assessmentAccent';
import themes from '../themes.json';
import type { Theme } from '../types';

const allThemes = themes.themes as Theme[];
const WHITE = 'FFFFFF';

// ---------------------------------------------------------------------------
// Canonical collision cases (spec explicitly names these)
// ---------------------------------------------------------------------------

describe('Canonical collision cases', () => {
  it('steel_crimson falls back to primary (red accent ≈ fail-red)', () => {
    const result = resolveAssessmentAccentById('steel_crimson');
    expect(result.fellBack).toBe(true);
    expect(result.collisionWith).toBe('fail');
  });

  it('slate_rust falls back to primary (rust accent in red/fail zone)', () => {
    const result = resolveAssessmentAccentById('slate_rust');
    expect(result.fellBack).toBe(true);
    // slate_rust #B5532A — rust orange, close to fail-red hue
    expect(['fail', 'warn']).toContain(result.collisionWith);
  });

  it('oxford_burgundy falls back to primary (deep burgundy in red hue family)', () => {
    const result = resolveAssessmentAccentById('oxford_burgundy');
    expect(result.fellBack).toBe(true);
    expect(result.collisionWith).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Clean themes — should NOT fall back
// ---------------------------------------------------------------------------

describe('Clean themes — no fallback', () => {
  it('navy_copper (copper accent) does not fall back', () => {
    const result = resolveAssessmentAccentById('navy_copper');
    expect(result.fellBack).toBe(false);
    expect(result.color).toBe('B0682C'); // accent itself
  });

  it('ink_teal (teal accent) does not fall back', () => {
    const result = resolveAssessmentAccentById('ink_teal');
    expect(result.fellBack).toBe(false);
  });

  it('graphite_electric (electric blue accent) does not fall back', () => {
    const result = resolveAssessmentAccentById('graphite_electric');
    expect(result.fellBack).toBe(false);
  });

  it('espresso_sage (sage green accent) does not fall back', () => {
    const result = resolveAssessmentAccentById('espresso_sage');
    expect(result.fellBack).toBe(false);
  });

  it('midnight_gold (gold accent) does not fall back', () => {
    const result = resolveAssessmentAccentById('midnight_gold');
    expect(result.fellBack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Warm-accent themes — do NOT fall back (warn-amber is intentionally not checked)
// ---------------------------------------------------------------------------
//
// These accents live in the orange/amber/gold/brown hue zone — the same hue
// space as the warn-amber status color. They are intentionally NOT treated as
// collisions because:
//   a) warm accents are recognisably branded (a copper arc ≠ a warn badge)
//   b) checking warn-amber would cause false positives on the four most common
//      "warm professional" accent choices in the library
//
// If product direction changes and warn-check is re-enabled, update these tests first.

describe('Warm-accent themes — no fallback (warn-amber exclusion)', () => {
  it('charcoal_amber keeps its amber accent (warm zone, not guarded)', () => {
    const result = resolveAssessmentAccentById('charcoal_amber');
    expect(result.fellBack).toBe(false);
    expect(result.color).toBe('C8881C');
  });

  it('midnight_gold keeps its gold accent (warm zone, not guarded)', () => {
    const result = resolveAssessmentAccentById('midnight_gold');
    expect(result.fellBack).toBe(false);
    expect(result.color).toBe('A9852F');
  });

  it('forest_stone keeps its bronze accent (warm zone, not guarded)', () => {
    const result = resolveAssessmentAccentById('forest_stone');
    expect(result.fellBack).toBe(false);
    expect(result.color).toBe('9C6B3F');
  });
});

// ---------------------------------------------------------------------------
// All 10 themes: returned color is always primary or accent
// ---------------------------------------------------------------------------

describe('All themes — returned color is primary or accent', () => {
  for (const theme of allThemes) {
    it(`${theme.id}`, () => {
      const result = resolveAssessmentAccent(theme);
      expect([theme.primary, theme.accent]).toContain(result.color);
    });
  }
});

// ---------------------------------------------------------------------------
// Fallback color (primary) passes AA text contrast
// ---------------------------------------------------------------------------

describe('All themes — primary (the fallback) passes 4.5:1 on white', () => {
  for (const theme of allThemes) {
    it(`${theme.id} primary #${theme.primary}`, () => {
      const ratio = contrastRatio(theme.primary, WHITE);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---------------------------------------------------------------------------
// resolveAssessmentAccentById vs resolveAssessmentAccent are consistent
// ---------------------------------------------------------------------------

describe('resolveAssessmentAccentById consistency', () => {
  for (const theme of allThemes) {
    it(`${theme.id}`, () => {
      const byObj = resolveAssessmentAccent(theme);
      const byId = resolveAssessmentAccentById(theme.id);
      expect(byObj).toEqual(byId);
    });
  }

  it('throws for unknown theme id', () => {
    expect(() => resolveAssessmentAccentById('nonexistent_theme')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RESOLVED_ACCENTS pre-computed lookup
// ---------------------------------------------------------------------------

describe('RESOLVED_ACCENTS pre-computed lookup', () => {
  it('has entries for all 10 themes', () => {
    expect(Object.keys(RESOLVED_ACCENTS)).toHaveLength(10);
  });

  for (const theme of allThemes) {
    it(`${theme.id} matches resolveAssessmentAccent()`, () => {
      expect(RESOLVED_ACCENTS[theme.id]).toEqual(resolveAssessmentAccent(theme));
    });
  }
});

// ---------------------------------------------------------------------------
// Color math unit tests
// ---------------------------------------------------------------------------

describe('hexToHsv()', () => {
  it('pure red → hue 0', () => {
    const [h] = hexToHsv('FF0000');
    expect(h).toBeCloseTo(0, 0);
  });

  it('pure green → hue 120', () => {
    const [h] = hexToHsv('00FF00');
    expect(h).toBeCloseTo(120, 0);
  });

  it('pure blue → hue 240', () => {
    const [h] = hexToHsv('0000FF');
    expect(h).toBeCloseTo(240, 0);
  });

  it('white → saturation 0', () => {
    const [, s] = hexToHsv(WHITE);
    expect(s).toBe(0);
  });
});

describe('hueDist()', () => {
  it('same hue → 0', () => {
    expect(hueDist(0, 0)).toBe(0);
  });

  it('wraps correctly across 360°', () => {
    expect(hueDist(350, 10)).toBe(20);
  });

  it('max distance is 180', () => {
    expect(hueDist(0, 180)).toBe(180);
    expect(hueDist(0, 181)).toBe(179);
  });
});

describe('checkCollision()', () => {
  it('pure red collides with fail', () => {
    const result = checkCollision('FF0000');
    expect(result.collides).toBe(true);
    expect(result.statusKey).toBe('fail');
  });

  it('pure blue does not collide', () => {
    const result = checkCollision('0000FF');
    expect(result.collides).toBe(false);
  });

  it('grey (low saturation) does not collide', () => {
    const result = checkCollision('808080');
    expect(result.collides).toBe(false);
  });

  it('fail-red itself collides with fail', () => {
    // STATUS_COLORS.fail is the exact status color — it should definitely collide
    const result = checkCollision(STATUS_COLORS.fail);
    expect(result.collides).toBe(true);
  });
});

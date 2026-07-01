/**
 * ScoutLane assessment accent resolution, lib/style/assessmentAccent.ts
 *
 * The fit assessment recolors its brand elements (top bar, gauge arc, headings)
 * from the selected theme. But the gauge arc must never visually resemble a
 * semantic STATUS color (pass/warn/fail), or users might misread the arc as
 * a score signal rather than brand decoration.
 *
 * resolveAssessmentAccent(theme) implements the collision guard:
 *   - Compute hue proximity AND contrast similarity between the theme accent
 *     and each status color.
 *   - If any threshold is triggered, fall back to theme `primary` for the arc.
 *   - Status colors themselves are NEVER themed and always stay fixed.
 *
 * Also exports WCAG contrast-ratio utilities used by the test suite.
 *
 * @module
 */

import themes from './themes.json';
import type { Theme, AssessmentAccentResult } from './types';

// ---------------------------------------------------------------------------
// Protected semantic status colors (from UI_UX_SPEC.md, never themed)
// ---------------------------------------------------------------------------

export const STATUS_COLORS = {
  pass: '1a7d46',  // --color-pass
  warn: 'b45309',  // --color-warn
  fail: 'c0392b',  // --color-fail
  info: '2563c9',  // --color-info / --color-link
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

// ---------------------------------------------------------------------------
// Collision thresholds
// ---------------------------------------------------------------------------

/**
 * A theme accent "collides" with a status color when it is perceptually close
 * enough that a viewer might confuse the gauge arc with a score indicator at a glance.
 *
 * We check proximity to FAIL-RED only (not warn-amber). Why:
 * - Red (#c0392b) has an immediate "failure" association, a red arc would read as
 *   a failed score before the user reads the number. This is the high-risk case.
 * - Warm-amber (#b45309) is NOT checked, because too many intentional brand accents
 *   (copper, amber, gold, bronze) live in the same hue zone. These accents are
 *   recognisably branded; a copper arc is not confused with a warn badge.
 * - Pass-green is included as a safety check, but in practice no current accent is near it.
 *
 * Collision triggers when BOTH conditions hold:
 *   1. Hue distance < HUE_THRESHOLD_DEG from the status hue
 *   2. Contrast ratio between accent and status < CONTRAST_THRESHOLD (similar luminance)
 *
 * An additional hue-only catch (< HUE_CLOSE_DEG) handles very-close hues regardless
 * of luminance (e.g. near-identical reds).
 *
 * Canonical fallback cases: steel_crimson (#B23B3B), slate_rust (#B5532A),
 * oxford_burgundy (#7B2D3A), all in the red/maroon hue family.
 */
const HUE_THRESHOLD_DEG = 20;    // within 20° of a guarded status hue → potential collision
const HUE_CLOSE_DEG = 10;        // within 10° → hue-only trigger (no contrast check needed)
const CONTRAST_THRESHOLD = 2.5;  // contrast < 2.5 between accent and status → too similar

// ---------------------------------------------------------------------------
// Color math utilities
// ---------------------------------------------------------------------------

/** Parse a 6-hex-digit color (no '#') into [r, g, b] in [0, 255]. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) throw new Error(`Invalid hex color: "${hex}"`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Linearise an 8-bit sRGB channel to linear light. */
function linearise(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.x relative luminance for a hex color (no '#').
 * Range [0, 1], 0 = black, 1 = white.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * WCAG contrast ratio between two hex colors.
 * Returns a value in [1, 21]. Thresholds: 3:1 graphics, 4.5:1 AA text.
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Convert an sRGB hex color to [hue (0–360), saturation (0–1), value (0–1)].
 * Uses the HSV (HSB) model for hue extraction.
 */
export function hexToHsv(hex: string): [number, number, number] {
  const [r8, g8, b8] = parseHex(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = ((hue * 60) + 360) % 360;
  }

  const saturation = max === 0 ? 0 : delta / max;
  const value = max;
  return [hue, saturation, value];
}

/**
 * Circular hue distance in degrees (always 0–180).
 */
export function hueDist(hue1: number, hue2: number): number {
  const diff = Math.abs(hue1 - hue2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ---------------------------------------------------------------------------
// Collision check
// ---------------------------------------------------------------------------

export interface CollisionReport {
  collides: boolean;
  statusKey?: StatusKey;
  hueDistDeg?: number;
  contrastWithStatus?: number;
  reason?: string;
}

/**
 * Check whether a hex accent color collides with any semantic status color.
 * Returns the first collision found (fail is checked first, then warn, then pass).
 */
export function checkCollision(accentHex: string): CollisionReport {
  const [accentHue, accentSat] = hexToHsv(accentHex);

  // Low-saturation accents (greys) don't collide with status hues
  if (accentSat < 0.15) {
    return { collides: false };
  }

  // Only check fail-red and pass-green. Warn-amber is intentionally excluded, 
  // too many valid warm accents (copper, amber, gold, bronze) share that hue range.
  const guardedStatuses: StatusKey[] = ['fail', 'pass'];

  for (const key of guardedStatuses) {
    const statusHex = STATUS_COLORS[key];
    const [statusHue] = hexToHsv(statusHex);

    const hd = hueDist(accentHue, statusHue);
    const cr = contrastRatio(accentHex, statusHex);

    // Hue-only trigger for very close hues, catches dark reds regardless of luminance
    if (hd < HUE_CLOSE_DEG) {
      return {
        collides: true,
        statusKey: key,
        hueDistDeg: hd,
        contrastWithStatus: cr,
        reason: `accent hue ${accentHue.toFixed(0)}° is within ${HUE_CLOSE_DEG}° of ${key} hue ${statusHue.toFixed(0)}° (hue-only trigger)`,
      };
    }

    // Combined hue + luminance trigger for near-misses
    if (hd < HUE_THRESHOLD_DEG && cr < CONTRAST_THRESHOLD) {
      return {
        collides: true,
        statusKey: key,
        hueDistDeg: hd,
        contrastWithStatus: cr,
        reason: `accent hue ${accentHue.toFixed(0)}° is ${hd.toFixed(1)}° from ${key} hue ${statusHue.toFixed(0)}° and contrast ${cr.toFixed(2)} < ${CONTRAST_THRESHOLD}`,
      };
    }
  }

  return { collides: false };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resolve the color to use for the gauge arc and themed brand graphics on
 * the fit assessment.
 *
 * - Returns `accent` if it does not collide with any semantic status color.
 * - Returns `primary` as the fallback if a collision is detected.
 *
 * The caller (assessment builder) should use this resolved color instead of
 * reaching for `accent` directly.
 *
 * @example
 * const { color, fellBack } = resolveAssessmentAccent(steelCrimsonTheme);
 * // fellBack === true, color === steelCrimsonTheme.primary
 *
 * @example
 * const { color, fellBack } = resolveAssessmentAccent(navyCopperTheme);
 * // fellBack === false, color === navyCopperTheme.accent
 */
export function resolveAssessmentAccent(theme: Theme): AssessmentAccentResult {
  const collision = checkCollision(theme.accent);

  if (collision.collides) {
    return {
      color: theme.primary,
      fellBack: true,
      collisionWith: collision.statusKey,
    };
  }

  return {
    color: theme.accent,
    fellBack: false,
  };
}

/**
 * Convenience: resolve by theme id.
 * Throws if the id is not found in themes.json.
 */
export function resolveAssessmentAccentById(themeId: string): AssessmentAccentResult {
  const theme = (themes.themes as Theme[]).find((t) => t.id === themeId);
  if (!theme) throw new Error(`Unknown theme id: "${themeId}"`);
  return resolveAssessmentAccent(theme);
}

// ---------------------------------------------------------------------------
// Pre-computed lookup, exported for the web layer
// ---------------------------------------------------------------------------

/**
 * Pre-compute and export the resolved accent for all 10 themes.
 * The web assessment component can import this map to avoid recomputing at runtime.
 *
 * Shape: { [themeId]: AssessmentAccentResult }
 */
export const RESOLVED_ACCENTS: Record<string, AssessmentAccentResult> = Object.fromEntries(
  (themes.themes as Theme[]).map((theme) => [theme.id, resolveAssessmentAccent(theme)]),
);

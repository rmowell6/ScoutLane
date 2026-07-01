// Client-safe view of the style data: dropdown options for the picker, and the CSS-variable map
// that re-skins the on-screen .packet preview so it matches the generated .docx. The docx builders
// consume the same themes.json/fonts.json server-side; this is the browser counterpart.
//
// packet.css is token-driven (--color-brand / --color-accent / --color-wash / --font-sans), so
// theming the preview is just overriding those custom properties on the .packet element. Status
// colors (pass/warn/fail/info) are intentionally NOT themed, they must stay semantically stable.
import themes from './themes.json'
import fonts from './fonts.json'
import type { Theme, FontPair } from './types'

export interface StyleOption {
  id: string
  name: string
}

const ALL_THEMES = themes.themes as Theme[]
const ALL_FONTS = fonts.pairs as FontPair[]

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order

export const THEME_OPTIONS: StyleOption[] = ALL_THEMES.slice()
  .sort(byOrder)
  .map((t) => ({ id: t.id, name: t.name }))

export const FONT_OPTIONS: StyleOption[] = ALL_FONTS.slice()
  .sort(byOrder)
  .map((f) => ({ id: f.id, name: f.name }))

const themeById = new Map(ALL_THEMES.map((t) => [t.id, t]))
const fontById = new Map(ALL_FONTS.map((f) => [f.id, f]))

const MASTER_THEME = themeById.get('navy_copper') ?? ALL_THEMES[0]
const MASTER_FONT = fontById.get('cambria_calibri') ?? ALL_FONTS[0]

/** Human names for a style id pair (for the "Themed: X · Y" label). Falls back to the id. */
export function styleNames(themeId: string, fontId: string): { theme: string; font: string } {
  return {
    theme: themeById.get(themeId)?.name ?? themeId,
    font: fontById.get(fontId)?.name ?? fontId,
  }
}

// Linux/web metric-twins for the live preview ONLY, never used in the .docx (see fonts.json note).
// They let a visitor without the MS fonts installed still see a faithful approximation in-browser.
const PREVIEW_TWIN: Record<string, string> = {
  Cambria: 'Caladea',
  Calibri: 'Carlito',
  Georgia: 'Gelasio',
  'Times New Roman': 'Tinos',
  Garamond: 'EB Garamond',
}
const SERIF_FONTS = new Set([
  'Cambria',
  'Georgia',
  'Garamond',
  'Constantia',
  'Times New Roman',
  'Book Antiqua',
  'Palatino Linotype',
])

/** Build a CSS font-family stack: the real MS font first, then a web twin, then a generic family. */
function fontStack(name: string): string {
  const parts = [`"${name}"`]
  const twin = PREVIEW_TWIN[name]
  if (twin) parts.push(`"${twin}"`)
  parts.push(SERIF_FONTS.has(name) ? 'serif' : 'sans-serif')
  return parts.join(', ')
}

export interface StylePreview {
  primary: string
  accent: string
  accentText: string
  slate: string
  wash: string
  headFont: string
  bodyFont: string
}

/**
 * The full palette + heading/body font stacks for a style id pair, for the mini resume preview
 * cards. Unknown ids fall back to the master skin (never throws). Decoupled from packetSkinVars:
 * the preview needs the whole palette (primary/accent/accentText/slate/wash), not just the four
 * CSS vars the on-screen packet overrides.
 */
export function previewStyle(themeId: string, fontId: string): StylePreview {
  const t = themeById.get(themeId) ?? MASTER_THEME
  const f = fontById.get(fontId) ?? MASTER_FONT
  const hex = (c: string) => `#${c}`
  return {
    primary: hex(t?.primary ?? '16335B'),
    accent: hex(t?.accent ?? 'B0682C'),
    accentText: hex(t?.accentText ?? 'AB652B'),
    slate: hex(t?.slate ?? '55606E'),
    wash: hex(t?.wash ?? 'EAEEF4'),
    headFont: fontStack(f?.head ?? 'Cambria'),
    bodyFont: fontStack(f?.body ?? 'Calibri'),
  }
}

/**
 * CSS custom properties that re-skin the .packet preview. Unknown ids fall back to the master skin
 * (never throws). Returned as a plain string map; spread into a React `style` prop.
 */
export function packetSkinVars(themeId: string, fontId: string): Record<string, string> {
  const t = themeById.get(themeId) ?? MASTER_THEME
  const f = fontById.get(fontId) ?? MASTER_FONT
  if (!t || !f) return {}
  const hex = (c: string) => `#${c}`
  return {
    '--color-brand': hex(t.primary),
    '--color-brand-strong': hex(t.primary),
    '--color-accent': hex(t.accent),
    '--color-wash': hex(t.wash),
    '--color-link': hex(t.primary),
    '--font-sans': `"${f.body}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  }
}

// Client-safe view of the style data: dropdown options for the picker, and the CSS-variable map
// that re-skins the on-screen .packet preview so it matches the generated .docx. The docx builders
// consume the same themes.json/fonts.json server-side; this is the browser counterpart.
//
// packet.css is token-driven (--color-brand / --color-accent / --color-wash / --font-sans), so
// theming the preview is just overriding those custom properties on the .packet element. Status
// colors (pass/warn/fail/info) are intentionally NOT themed — they must stay semantically stable.
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

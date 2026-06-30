'use client'

// A scaled-down, STATIC mini render of what a resume looks like in a given style (theme + font),
// shown as a selectable card in the style picker. The point is to let people compare header
// treatment, color, and font BEFORE generating — cutting regenerate-to-retry cycles (and AI cost).
//
// Not interactive and not the real document: it reuses the same design tokens (previewStyle pulls
// from themes.json/fonts.json) so it stays faithful to the .docx the builders produce, but it is a
// lightweight typographic mock, not a rendered .docx.
import { previewStyle } from '@/lib/style/skin'

export default function StylePreviewCard({
  themeId,
  fontId,
  themeName,
  selected,
  onSelect,
}: {
  themeId: string
  fontId: string
  themeName: string
  selected: boolean
  onSelect: (themeId: string) => void
}) {
  const s = previewStyle(themeId, fontId)

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Use the ${themeName} style`}
      onClick={() => onSelect(themeId)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 6,
        borderRadius: 10,
        border: `2px solid ${selected ? s.primary : 'var(--border)'}`,
        background: 'var(--card)',
        cursor: 'pointer',
        boxShadow: selected ? `0 0 0 3px ${s.wash}` : 'none',
        transition: 'border-color 0.12s, box-shadow 0.12s',
      }}
    >
      {/* The mini "paper" — fixed aspect, white, with a faint page border. */}
      <div
        aria-hidden
        style={{
          background: '#ffffff',
          border: '1px solid #ececec',
          borderRadius: 4,
          padding: '9px 10px',
          height: 132,
          overflow: 'hidden',
        }}
      >
        {/* Name band on the theme wash */}
        <div style={{ background: s.wash, margin: '-9px -10px 7px', padding: '7px 10px 6px' }}>
          <div style={{ fontFamily: s.headFont, fontSize: 13, fontWeight: 700, color: s.primary, lineHeight: 1.05 }}>
            Jordan Rivera
          </div>
          <div style={{ fontFamily: s.bodyFont, fontSize: 5.5, color: s.slate, marginTop: 2, letterSpacing: 0.2 }}>
            SENIOR ENGINEER · jordan@email.com · 555-0100
          </div>
        </div>

        <Section accent={s.accent} primary={s.primary} headFont={s.headFont}>
          EXPERIENCE
        </Section>
        <Job s={s} title="Staff Engineer, Acme" date="2022 — Present" />
        <Job s={s} title="Senior Engineer, Globex" date="2019 — 2022" />

        <Section accent={s.accent} primary={s.primary} headFont={s.headFont}>
          SKILLS
        </Section>
        <div style={{ fontFamily: s.bodyFont, fontSize: 5.5, color: s.slate, lineHeight: 1.5 }}>
          Distributed systems · Go · Kubernetes · Postgres
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 12, fontWeight: selected ? 700 : 500, color: selected ? s.primary : 'var(--text)' }}>
        {selected ? '✓ ' : ''}
        {themeName}
      </div>
    </button>
  )
}

type S = ReturnType<typeof previewStyle>

// A section header: label in the theme's primary + heading font, underlined with an accent rule and
// a small accent marker — the same header treatment the .docx resume builder applies.
function Section({ children, accent, primary, headFont }: { children: string; accent: string; primary: string; headFont: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        margin: '7px 0 3px',
        paddingBottom: 1.5,
        borderBottom: `1px solid ${accent}`,
      }}
    >
      <span style={{ color: accent, fontSize: 6 }}>■</span>
      <span style={{ fontFamily: headFont, fontSize: 7, fontWeight: 700, color: primary, letterSpacing: 0.6 }}>{children}</span>
    </div>
  )
}

function Job({ s, title, date }: { s: S; title: string; date: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: s.bodyFont, fontSize: 6.5, fontWeight: 700, color: '#1a1a1a' }}>{title}</span>
        <span style={{ fontFamily: s.bodyFont, fontSize: 5.5, color: s.accentText, whiteSpace: 'nowrap' }}>{date}</span>
      </div>
      {['Led the migration that cut p95 latency 40%.', 'Owned reliability across four services.'].map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 3, marginTop: 1.5 }}>
          <span style={{ color: s.accent, fontSize: 5 }}>▪</span>
          <span style={{ fontFamily: s.bodyFont, fontSize: 5.5, color: s.slate, lineHeight: 1.3 }}>{b}</span>
        </div>
      ))}
    </div>
  )
}

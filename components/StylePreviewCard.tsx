'use client'

// Selectable cards for the style picker. Two kinds share one card shell and the same radio
// semantics (the picker is a single-select radiogroup):
//   - StylePreviewCard: a scaled-down, STATIC mini render of a résumé in a given theme + font, so
//     people can compare header treatment, color, and font BEFORE generating — cutting
//     regenerate-to-retry cycles (and AI cost). Reuses the design tokens (previewStyle pulls from
//     themes.json/fonts.json), so it stays faithful to the .docx the builders produce.
//   - RecommendedCard: the "let ScoutLane match a theme to this role" option. It has no preview on
//     purpose — the recommendation is chosen by the model from the role at generation time, so there
//     is nothing truthful to render here yet; showing a fake résumé would mislead.
import { forwardRef } from 'react'
import { previewStyle } from '@/lib/style/skin'

const APP_ACCENT = '#065F46' // forest-green "Signal" accent (matches app/app/page.module.css --accent)
const APP_WASH = '#ECFDF5'

// Shared card chrome. `accent` drives the selected border + focus ring so a theme card highlights in
// its own brand color and the recommended card in the app green.
function shellStyle(checked: boolean, accent: string): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: 6,
    borderRadius: 10,
    border: `2px solid ${checked ? accent : 'var(--border)'}`,
    background: 'var(--card)',
    cursor: 'pointer',
    boxShadow: checked ? `0 0 0 3px ${APP_WASH}` : 'none',
    transition: 'border-color 0.12s, box-shadow 0.12s',
  }
}

interface CommonProps {
  value: string
  checked: boolean
  tabIndex: number
  onSelect: (value: string) => void
}

export const RecommendedCard = forwardRef<HTMLButtonElement, Omit<CommonProps, 'value'>>(
  function RecommendedCard({ checked, tabIndex, onSelect }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={tabIndex}
        aria-label="Recommended for this role, ScoutLane picks the best theme automatically"
        onClick={() => onSelect('__recommended__')}
        style={shellStyle(checked, APP_ACCENT)}
      >
        <div
          aria-hidden
          style={{
            height: 132,
            borderRadius: 4,
            border: `1px dashed ${checked ? APP_ACCENT : '#cbd5d0'}`,
            background: APP_WASH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '10px 12px',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>✨</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: APP_ACCENT }}>Recommended</span>
          <span style={{ fontSize: 10.5, color: '#4B5563', lineHeight: 1.35 }}>
            ScoutLane matches a professional theme to this role when you generate.
          </span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: checked ? 700 : 500, color: checked ? APP_ACCENT : 'var(--text)' }}>
          {checked ? '✓ ' : ''}
          For this role (auto)
        </div>
      </button>
    )
  },
)

interface StylePreviewCardProps extends CommonProps {
  fontId: string
  themeName: string
}

const StylePreviewCard = forwardRef<HTMLButtonElement, StylePreviewCardProps>(function StylePreviewCard(
  { value, fontId, themeName, checked, tabIndex, onSelect },
  ref,
) {
  const s = previewStyle(value, fontId)

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      aria-label={`Use the ${themeName} style`}
      onClick={() => onSelect(value)}
      style={shellStyle(checked, s.primary)}
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
        <Job s={s} title="Staff Engineer, Acme" date="2022 – Present" />
        <Job s={s} title="Senior Engineer, Globex" date="2019 – 2022" />

        <Section accent={s.accent} primary={s.primary} headFont={s.headFont}>
          SKILLS
        </Section>
        <div style={{ fontFamily: s.bodyFont, fontSize: 5.5, color: s.slate, lineHeight: 1.5 }}>
          Distributed systems · Go · Kubernetes · Postgres
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 12, fontWeight: checked ? 700 : 500, color: checked ? s.primary : 'var(--text)' }}>
        {checked ? '✓ ' : ''}
        {themeName}
      </div>
    </button>
  )
})

export default StylePreviewCard

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

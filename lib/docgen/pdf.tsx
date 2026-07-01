// PDF renderers for the three packet documents (résumé, cover letter, fit assessment).
//
// Why a second renderer: the DOCX builders (resume.ts / coverLetter.ts / fitAssessment.ts) are the
// editable deliverable, but not everyone has Word, so we also ship a PDF for viewing/printing/attaching.
// These builders take the SAME content models the DOCX builders consume (ResumeContent,
// CoverLetterContent, FitAssessmentContent) so the two formats never drift in CONTENT — only in
// rendering engine. @react-pdf/renderer is pure JS (no headless Chrome / LibreOffice binary), so it
// runs on the Node serverless runtime the /api/packet route already uses (runtime='nodejs').
//
// Fidelity note: color is themed (same tokens as the DOCX), but TYPOGRAPHY maps to the PDF standard-14
// fonts — SERIF→Times, SANS→Helvetica. That keeps the PDF ATS-safe (standard fonts, single column,
// real selectable text, no images/tables) and avoids bundling font binaries. The themed Microsoft
// fonts remain in the DOCX, which is the format meant for editing.
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { Theme, AssessmentAccentResult } from '@/lib/style/types'
import type { ResumeContent } from '@/lib/docgen/resume'
import type { CoverLetterContent } from '@/lib/docgen/coverLetter'
import type { FitAssessmentContent, FitDimGroup } from '@/lib/docgen/fitAssessment'

// Standard-14 PDF fonts — no registration, no binaries, ATS-safe.
const SERIF_BOLD = 'Times-Bold'
const SANS = 'Helvetica'
const SANS_BOLD = 'Helvetica-Bold'
const SANS_ITALIC = 'Helvetica-Oblique'

const INK = '#1A1A1A'
const hex = (c: string) => (c.startsWith('#') ? c : `#${c}`)

// Resolve the themed colors into '#'-prefixed values the renderer expects.
interface Tokens {
  navy: string
  accent: string
  accentText: string
  slate: string
  wash: string
}
function tokensFromTheme(theme: Theme, accentOverride?: string): Tokens {
  return {
    navy: hex(theme.primary),
    accent: hex(accentOverride ?? theme.accent),
    accentText: hex(accentOverride ?? theme.accentText),
    slate: hex(theme.slate),
    wash: hex(theme.wash),
  }
}

const PREFERRED_STATUS_TEXT: Record<'match' | 'partial' | 'gap', string> = {
  match: 'In your background',
  partial: 'Partial / cert-backed',
  gap: 'Not present',
}
const GROUP_TITLES: Record<FitDimGroup, string> = {
  strength: 'Your strengths',
  stretch: 'Worth shoring up',
  unassessed: 'Not assessed',
}

// ---- shared primitives ------------------------------------------------------
const base = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 52, fontFamily: SANS, fontSize: 10.5, color: INK },
  topBar: { height: 3 },
  header: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  name: { fontFamily: SERIF_BOLD, letterSpacing: 3, textAlign: 'center' },
  tagline: { fontFamily: SANS_BOLD, letterSpacing: 1.4, fontSize: 11, textAlign: 'center', marginTop: 6 },
  subtitle: { fontSize: 10, textAlign: 'center', marginTop: 4, letterSpacing: 0.4 },
  contactRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 7, fontSize: 9.5 },
  divider: { height: 1.5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingBottom: 4, borderBottomWidth: 1 },
  sectionSquare: { width: 6, height: 6, marginRight: 6 },
  sectionTitle: { fontFamily: SERIF_BOLD, fontSize: 12, letterSpacing: 1.6 },
  para: { fontSize: 10.5, lineHeight: 1.4, marginTop: 8 },
  bulletRow: { flexDirection: 'row', marginTop: 4, paddingRight: 6 },
  bulletMark: { width: 10, fontSize: 10.5 },
  bulletText: { flex: 1, fontSize: 10.5, lineHeight: 1.35 },
})

/** Section header: a small colored square + a navy title with a bottom rule. */
function SectionHeader({ text, t }: { text: string; t: Tokens }) {
  return (
    <View style={[base.sectionHeader, { borderBottomColor: t.navy }]}>
      <View style={[base.sectionSquare, { backgroundColor: t.accent }]} />
      <Text style={[base.sectionTitle, { color: t.navy }]}>{text.toUpperCase()}</Text>
    </View>
  )
}

function Bullet({ text, color }: { text: string; color: string }) {
  return (
    <View style={base.bulletRow} wrap={false}>
      <Text style={[base.bulletMark, { color }]}>{'•'}</Text>
      <Text style={base.bulletText}>{text}</Text>
    </View>
  )
}

/** Centered header block shared by all three docs (name / tagline / subtitle / contact). */
function HeaderBlock({
  t,
  name,
  tagline,
  subtitle,
  contact,
  nameSize = 26,
}: {
  t: Tokens
  name: string
  tagline: string
  subtitle?: string
  contact?: { location: string; phone: string; email: string }
  nameSize?: number
}) {
  return (
    <>
      <View style={[base.topBar, { backgroundColor: t.accent }]} />
      <View style={[base.header, { backgroundColor: t.wash }]}>
        <Text style={[base.name, { color: t.navy, fontSize: nameSize }]}>{name.toUpperCase()}</Text>
        <Text style={[base.tagline, { color: t.accentText }]}>{tagline.toUpperCase()}</Text>
        {subtitle ? <Text style={[base.subtitle, { color: t.slate }]}>{subtitle}</Text> : null}
        {contact ? (
          <View style={base.contactRow}>
            <Text>{contact.location}</Text>
            <Text style={{ color: t.accent }}>{'      •      '}</Text>
            <Text>{contact.phone}</Text>
            <Text style={{ color: t.accent }}>{'      •      '}</Text>
            <Text>{contact.email}</Text>
          </View>
        ) : null}
      </View>
      <View style={[base.divider, { backgroundColor: t.navy }]} />
    </>
  )
}

// ---- résumé -----------------------------------------------------------------
const rs = StyleSheet.create({
  jobHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 },
  company: { fontFamily: SERIF_BOLD, fontSize: 12 },
  dates: { fontFamily: SANS_BOLD, fontSize: 10 },
  jobTitle: { fontFamily: SANS_ITALIC, fontSize: 10.5, marginTop: 2 },
  jobContext: { fontSize: 10, marginTop: 2 },
  skillRow: { flexDirection: 'row', marginTop: 6 },
  skillLabel: { fontFamily: SANS_BOLD, fontSize: 10.5 },
  certSub: { fontFamily: SANS_BOLD, fontSize: 9, letterSpacing: 1.4, marginTop: 10, marginBottom: 2 },
  certName: { fontFamily: SANS_BOLD, fontSize: 10.5 },
  eduLine: { flexDirection: 'row', marginTop: 8 },
  school: { fontFamily: SERIF_BOLD, fontSize: 11 },
  authLine: { fontFamily: SANS_ITALIC, fontSize: 9, textAlign: 'center', marginTop: 18 },
})

function ResumeDoc({ content, t }: { content: ResumeContent; t: Tokens }) {
  return (
    <Document title={`${content.name} — ${content.tagline} Resume`} author={content.name}>
      <Page size="LETTER" style={base.page}>
        <HeaderBlock
          t={t}
          name={content.name}
          tagline={content.tagline}
          subtitle={content.subtitle}
          contact={content.contact}
        />

        {content.summary.trim() ? (
          <>
            <SectionHeader text="Summary" t={t} />
            <Text style={base.para}>{content.summary}</Text>
          </>
        ) : null}

        {content.skillCategories.length > 0 ? (
          <>
            <SectionHeader text="Technical Skills" t={t} />
            {content.skillCategories.map((s, i) => (
              <View key={i} style={rs.skillRow}>
                <Text style={[rs.skillLabel, { color: t.navy }]}>{s.label}   </Text>
                <Text style={{ flex: 1, fontSize: 10.5 }}>{s.items}</Text>
              </View>
            ))}
          </>
        ) : null}

        {content.experience.length > 0 ? (
          <>
            <SectionHeader text="Professional Experience" t={t} />
            {content.experience.map((e, i) => (
              <View key={i} wrap={false}>
                <View style={rs.jobHead}>
                  <Text style={[rs.company, { color: t.navy }]}>{e.company}</Text>
                  <Text style={[rs.dates, { color: t.accentText }]}>{e.dates}</Text>
                </View>
                <Text style={[rs.jobTitle, { color: t.slate }]}>{e.title}</Text>
                {e.context.trim() ? <Text style={[rs.jobContext, { color: t.slate }]}>{e.context}</Text> : null}
                {e.bullets.map((b, j) => (
                  <Bullet key={j} text={b} color={t.accent} />
                ))}
              </View>
            ))}
          </>
        ) : null}

        {content.earlier.length > 0 ? (
          <>
            <SectionHeader text="Earlier Experience" t={t} />
            {content.earlier.map((e, i) => (
              <Text key={i} style={{ fontSize: 10.5, marginTop: 6 }}>
                <Text style={{ fontFamily: SERIF_BOLD, color: t.navy }}>{e.company}</Text>
                <Text style={{ color: t.accent }}>{'   •   '}</Text>
                <Text style={{ fontFamily: SANS_ITALIC, color: t.slate }}>{e.role}. </Text>
                <Text style={{ color: t.slate }}>{e.detail}</Text>
              </Text>
            ))}
          </>
        ) : null}

        {content.certs.active.length > 0 || content.certs.previouslyHeld.length > 0 ? (
          <>
            <SectionHeader text="Certifications" t={t} />
            {content.certs.active.length > 0 ? (
              <>
                <Text style={[rs.certSub, { color: t.accentText }]}>ACTIVE</Text>
                {content.certs.active.map((c, i) => (
                  <View key={i} style={base.bulletRow} wrap={false}>
                    <Text style={[base.bulletMark, { color: t.accent }]}>{'•'}</Text>
                    <Text style={base.bulletText}>
                      <Text style={rs.certName}>{c.name}</Text>
                      {c.note ? <Text style={{ fontFamily: SANS_ITALIC, color: t.slate }}>{`  ${c.note}`}</Text> : null}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
            {content.certs.previouslyHeld.length > 0 ? (
              <>
                <Text style={[rs.certSub, { color: t.accentText }]}>PREVIOUSLY HELD</Text>
                {content.certs.previouslyHeld.map((c, i) => (
                  <View key={i} style={base.bulletRow} wrap={false}>
                    <Text style={[base.bulletMark, { color: t.accent }]}>{'•'}</Text>
                    <Text style={base.bulletText}>
                      <Text style={rs.certName}>{c.name}</Text>
                      {c.note ? <Text style={{ fontFamily: SANS_ITALIC, color: t.slate }}>{`  ${c.note}`}</Text> : null}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {content.education.length > 0 ? (
          <>
            <SectionHeader text="Education" t={t} />
            {content.education.map((e, i) => (
              <Text key={i} style={{ fontSize: 10.5, marginTop: 8 }}>
                <Text style={{ fontFamily: SERIF_BOLD, color: t.navy }}>{e.school}</Text>
                <Text style={{ color: t.accent }}>{'   •   '}</Text>
                <Text>{e.detail}</Text>
              </Text>
            ))}
          </>
        ) : null}

        {content.authLine.trim() ? (
          <Text style={[rs.authLine, { color: t.slate }]}>{content.authLine}</Text>
        ) : null}
      </Page>
    </Document>
  )
}

// ---- cover letter -----------------------------------------------------------
const cl = StyleSheet.create({
  meta: { fontSize: 10.5, marginTop: 3 },
  salutation: { fontSize: 10.5, marginTop: 12 },
  para: { fontSize: 10.5, lineHeight: 1.5, marginTop: 10 },
  closing: { fontSize: 10.5, marginTop: 14 },
  signature: { fontFamily: SERIF_BOLD, fontSize: 12, marginTop: 4 },
})

function CoverLetterDoc({ content, t }: { content: CoverLetterContent; t: Tokens }) {
  const c = content.candidate
  return (
    <Document title={`${content.signature} Cover Letter`} author={content.signature}>
      <Page size="LETTER" style={base.page}>
        <HeaderBlock
          t={t}
          name={c.name}
          tagline={c.tagline}
          contact={{ location: c.location, phone: c.phone, email: c.email }}
          nameSize={23}
        />
        <View style={{ marginTop: 14 }}>
          <Text style={[cl.meta, { color: t.slate }]}>{content.date}</Text>
          {content.recipient ? <Text style={[cl.meta, { color: t.slate }]}>{content.recipient}</Text> : null}
          {content.reLine ? <Text style={[cl.meta, { color: t.slate }]}>{content.reLine}</Text> : null}
        </View>
        <Text style={cl.salutation}>{content.salutation}</Text>
        {content.paragraphs.map((p, i) => (
          <Text key={i} style={cl.para}>
            {p}
          </Text>
        ))}
        <Text style={cl.closing}>{content.closing}</Text>
        <Text style={[cl.signature, { color: t.navy }]}>{content.signature}</Text>
      </Page>
    </Document>
  )
}

// ---- fit assessment ---------------------------------------------------------
const fa = StyleSheet.create({
  overallRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  overallScore: { fontFamily: SERIF_BOLD, fontSize: 20 },
  overallBand: { fontFamily: SANS_BOLD, fontSize: 12, marginLeft: 10 },
  bandSummary: { fontSize: 10.5, lineHeight: 1.4, marginTop: 6 },
  holdingBack: { fontFamily: SANS_ITALIC, fontSize: 9.5, marginTop: 6 },
  groupHeader: { fontFamily: SANS_BOLD, fontSize: 9, letterSpacing: 1.4, marginTop: 12, marginBottom: 2 },
  dimRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dimLabel: { fontFamily: SANS_BOLD, fontSize: 10.5 },
  dimScore: { fontFamily: SANS_BOLD, fontSize: 10.5 },
  dimNote: { fontSize: 10, marginTop: 1 },
  prefIntro: { fontFamily: SANS_ITALIC, fontSize: 9.5, marginTop: 6 },
  prefRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  footer: { fontFamily: SANS_ITALIC, fontSize: 9, textAlign: 'center', marginTop: 22 },
})

function FitAssessmentDoc({ content, t }: { content: FitAssessmentContent; t: Tokens }) {
  const subtitle = [content.roleTitle, content.company].filter(Boolean).join('  ·  ')
  return (
    <Document title={`${content.candidateName} — Fit Assessment`} author={content.candidateName}>
      <Page size="LETTER" style={base.page}>
        <HeaderBlock t={t} name={content.candidateName} tagline="Fit Assessment" subtitle={subtitle || undefined} nameSize={23} />
        <Text style={{ fontSize: 9.5, textAlign: 'center', marginTop: 5, color: INK }}>{content.date}</Text>

        <SectionHeader text="Overall" t={t} />
        <View style={fa.overallRow}>
          <Text style={[fa.overallScore, { color: t.navy }]}>{`${content.overall} / 100`}</Text>
          <Text style={[fa.overallBand, { color: t.accent }]}>{content.bandLabel}</Text>
        </View>
        <Text style={fa.bandSummary}>{content.bandSummary}</Text>
        {content.holdingBack ? <Text style={[fa.holdingBack, { color: t.slate }]}>{content.holdingBack}</Text> : null}

        <SectionHeader text="Assessment by dimension" t={t} />
        {content.dimensions.map((d, i) => {
          // Emit a group sub-header only when the group changes (dimensions are pre-ordered). Derived
          // purely from the previous item's group so nothing is mutated during render.
          const showGroup = content.dimensions[i - 1]?.group !== d.group
          const scoreColor = d.group === 'unassessed' ? t.slate : t.accent
          return (
            <View key={i} wrap={false}>
              {showGroup ? <Text style={[fa.groupHeader, { color: t.accent }]}>{GROUP_TITLES[d.group].toUpperCase()}</Text> : null}
              <View style={fa.dimRow}>
                <Text style={[fa.dimLabel, { color: t.navy }]}>{d.label}</Text>
                <Text style={[fa.dimScore, { color: scoreColor }]}>{d.scoreText}</Text>
              </View>
              {d.note ? <Text style={[fa.dimNote, { color: t.slate }]}>{d.note}</Text> : null}
            </View>
          )
        })}

        {content.hardGaps.length > 0 ? (
          <>
            <SectionHeader text="Hard gaps" t={t} />
            {content.hardGaps.map((g, i) => (
              <Bullet key={i} text={g} color={t.accent} />
            ))}
          </>
        ) : null}

        {content.preferredSkills.length > 0 ? (
          <>
            <SectionHeader text="Preferred keywords (nice-to-have)" t={t} />
            <Text style={[fa.prefIntro, { color: t.slate }]}>
              These help with ATS keyword matching but do NOT affect the score above, so a gap here is not a strike against
              you.
            </Text>
            {content.preferredSkills.map((p, i) => (
              <View key={i} style={fa.prefRow}>
                <Text style={{ fontSize: 10.5, color: t.navy }}>{p.skill}</Text>
                <Text style={{ fontSize: 10, color: p.status === 'match' ? t.accent : t.slate }}>
                  {PREFERRED_STATUS_TEXT[p.status]}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <Text style={[fa.footer, { color: t.slate }]}>
          Built from your structured history and stated preferences. This is a private decision aid for you, never shared
          with the employer.
        </Text>
      </Page>
    </Document>
  )
}

// ---- public builders (mirror the DOCX builder signatures) -------------------
export async function buildResumePdf(content: ResumeContent, theme: Theme): Promise<Buffer> {
  return renderToBuffer(<ResumeDoc content={content} t={tokensFromTheme(theme)} />)
}

export async function buildCoverLetterPdf(content: CoverLetterContent, theme: Theme): Promise<Buffer> {
  return renderToBuffer(<CoverLetterDoc content={content} t={tokensFromTheme(theme)} />)
}

export async function buildFitAssessmentPdf(
  content: FitAssessmentContent,
  theme: Theme,
  accent: AssessmentAccentResult,
): Promise<Buffer> {
  // The assessment uses the collision-guarded accent (never theme.accent directly), matching the DOCX.
  return renderToBuffer(<FitAssessmentDoc content={content} t={tokensFromTheme(theme, accent.color)} />)
}

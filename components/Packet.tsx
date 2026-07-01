'use client'

// Accessible Application Packet view (UI_UX_SPEC.md / packet.template.html). A pure render of the
// deterministic FitResult + tailored content, no scoring logic here. Semantics per the spec:
// one <h1>, sections labelled by their <h2>, role="meter" for the gauge and sub-score bars (never
// progressbar), status conveyed by text + icon (never color alone), WCAG 2.2 AA tokens.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Packet, DocumentRef, DocFormats } from '@/lib/services/buildPacket'
import type { FitDimension } from '@/lib/fit/fitScore'
import {
  isUnassessed,
  bandLabel,
  bandSummary,
  humanizeNote,
  splitDimensions,
  holdingBackLine,
  leadDimension,
} from '@/lib/fit/fitPresent'
import { styleNames } from '@/lib/style/skin'
import { describeGuardrailFailure } from '@/lib/guardrailMessages'
import { track, EVENTS } from '@/lib/analytics'

/** Allow CSS custom properties (e.g. --value) in inline styles. */
type VarStyle = CSSProperties & Record<`--${string}`, string | number>

type Status = 'is-pass' | 'is-warn' | 'is-fail'

function meterStatus(score: number): Status {
  if (score >= 75) return 'is-pass'
  if (score >= 55) return 'is-warn'
  return 'is-fail'
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'is-pass') {
    return (
      <svg aria-hidden="true" viewBox="0 0 10 10">
        <path d="M1 5l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )
  }
  if (status === 'is-warn') {
    return (
      <svg aria-hidden="true" viewBox="0 0 10 10">
        <path d="M5 1l4 7H1z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function statusLabel(status: Status): string {
  return status === 'is-pass' ? 'Match' : status === 'is-warn' ? 'Partial' : 'Gap'
}

function Meter({ d }: { d: FitDimension }) {
  const status = meterStatus(d.score)
  const noteId = `meter-note-${d.key}`
  // No real data to score this dimension: show "Not assessed" rather than a placeholder bar that
  // reads as a measured verdict. No role="meter" here, there is no meaningful value to announce.
  if (isUnassessed(d)) {
    return (
      <div className="meter is-muted">
        <div className="meter__top">
          <span className="meter__label">{d.label}</span>
          <span className="meter__val muted" aria-hidden="true">
            Not assessed
          </span>
        </div>
        <p className="meter__note muted" id={noteId}>
          {humanizeNote(d)}
        </p>
      </div>
    )
  }
  // The role="meter" sits on the bar itself, not the wrapper: a meter is a leaf role, so prose
  // placed inside it (the note) isn't reliably exposed. Keep the note a sibling and wire it in via
  // aria-describedby so screen readers announce "<label>: N of 100" plus the explanation.
  return (
    <div className={`meter ${status}`}>
      <div className="meter__top">
        <span className="meter__label">{d.label}</span>
        <span className="meter__val" aria-hidden="true">
          {d.score}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-valuenow={d.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${d.label}: ${d.score} of 100`}
        aria-describedby={noteId}
      >
        <div className="meter__fill" style={{ '--value': d.score } as VarStyle} />
      </div>
      <p className="meter__note" id={noteId}>
        {humanizeNote(d)}
      </p>
    </div>
  )
}

/** A titled group of meters (Your strengths / Worth shoring up / Not assessed). Renders nothing when
 *  empty unless an `emptyHint` is given. */
function MeterGroup({ title, dims, emptyHint }: { title: string; dims: FitDimension[]; emptyHint?: string }) {
  if (dims.length === 0 && !emptyHint) return null
  return (
    <div className="meter-group">
      <p className="meter-group__title">{title}</p>
      {dims.length > 0 ? (
        dims.map((d) => <Meter key={d.key} d={d} />)
      ) : (
        <p className="muted" style={{ fontSize: '12px', margin: 0 }}>
          {emptyHint}
        </p>
      )}
    </div>
  )
}

function CoverageBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <StatusIcon status={status} />
      {statusLabel(status)}
    </span>
  )
}

/** Keyword/ATS coverage table for one tier of skills (required vs preferred). */
function CoverageCard({
  id,
  title,
  skillHeader,
  rows,
  intro,
  footer,
}: {
  id: string
  title: string
  skillHeader: string
  rows: { skill: string; status: Status }[]
  intro?: string
  footer?: ReactNode
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {intro && (
        <p className="muted" style={{ margin: '0 0 10px', fontSize: '12.5px' }}>
          {intro}
        </p>
      )}
      <table className="data-table" aria-labelledby={id}>
        <thead>
          <tr>
            <th scope="col">{skillHeader}</th>
            <th scope="col">Your coverage</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ skill, status }) => (
            <tr key={skill}>
              <th scope="row">{skill}</th>
              <td className="muted">
                {status === 'is-pass'
                  ? 'In your background'
                  : status === 'is-warn'
                    ? 'Partial / cert-backed'
                    : 'Not present'}
              </td>
              <td>
                <CoverageBadge status={status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </section>
  )
}

function downloadDoc(doc: DocumentRef) {
  const trigger = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  if (doc.signedUrl) return trigger(doc.signedUrl)
  if (doc.base64) {
    const binary = atob(doc.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    // Use the ref's own MIME so a PDF reconstructs as application/pdf, a docx as its Office type.
    const url = URL.createObjectURL(new Blob([bytes], { type: doc.mime }))
    trigger(url)
    // Revoking on a 0ms timer can race the browser's own fetch of the blob and abort the download
    // (notably in Firefox). Hold the URL for a comfortable window, the file is a few KB, then free it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12">
      <path d="M6 1v6M3.5 5L6 7.5 8.5 5M2 10.5h8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * One document, downloadable in each format as two equal buttons: PDF (opens anywhere) and DOCX
 * (editable Word). The row is a grid, name, then the two buttons, so the buttons stay beside the
 * name and line up in columns across the three documents.
 */
function DocButton({ formats, label }: { formats: DocFormats; label: string }) {
  const [done, setDone] = useState<'pdf' | 'docx' | null>(null)
  const grab = (format: 'pdf' | 'docx') => {
    downloadDoc(formats[format])
    // Activation funnel: downloading a tailored doc is the "opened a packet" signal.
    track(EVENTS.packetOpened, { doc: label, format })
    setDone(format)
    setTimeout(() => setDone((d) => (d === format ? null : d)), 2500)
  }
  return (
    <div className="doc-row">
      <span className="doc-name">{label}</span>
      <button type="button" className="download-btn" onClick={() => grab('pdf')}>
        <DownloadIcon />
        {done === 'pdf' ? 'Saved ✓' : 'Download PDF'}
      </button>
      <button type="button" className="download-btn" onClick={() => grab('docx')}>
        <DownloadIcon />
        {done === 'docx' ? 'Saved ✓' : 'Download DOCX'}
      </button>
    </div>
  )
}

// Copy-to-clipboard control for an outreach variant. Mirrors DocButton's transient "done" feedback.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 2500)
        } catch {
          // Clipboard can be blocked (permissions / insecure context); fail quietly, the text is
          // still visible on screen for manual selection.
        }
      }}
    >
      {done ? 'Copied ✓' : `Copy ${label}`}
    </button>
  )
}

export default function PacketView({ packet, sourceUrl }: { packet: Packet; sourceUrl?: string | null }) {
  const { fit, fitInput, jobReqs, guardrails, documents, style, styleWhy, tailored } = packet
  const roleTitle = jobReqs.title ?? 'Target role'
  const heading = jobReqs.company ? `${jobReqs.company} · ${roleTitle}` : roleTitle

  // The on-screen packet uses a FIXED forest-green skin (app/packet.css) so the app matches the
  // marketing site. The downloaded .docx keep their own document theme, styleLabel still names that
  // palette so the "Style:" line stays truthful about the files the user gets.
  const styleLabel = styleNames(style.theme, style.font)

  const pills = [
    jobReqs.comp,
    jobReqs.location ?? humanize(fitInput.location),
    `${humanize(fitInput.employerType)} employer`,
  ].filter((p): p is string => Boolean(p))

  // Held back: a guardrail failed OR no documents were generated. Per the product's flag-don't-hide
  // guardrail philosophy the score stays visible (it is still real fit signal), but it must never
  // read as a clean, finished result, so we pair it with a review banner carrying the plain-language
  // reasons. `describeGuardrailFailure` assumes a failed report; guarding on `friendly` keeps the
  // banner out of the normal path. Defense-in-depth: the route already withholds a failed packet
  // (422), so this protects any path that DOES hand the view a blocked packet.
  const friendly = !guardrails.ok || documents === null ? describeGuardrailFailure(guardrails) : null

  // Group the deterministic dimensions for a strengths-first read, and derive the one-line "what's
  // holding this back". All shared with the generated document via lib/fit/fitPresent.
  const { strengths, stretches, notAssessed } = splitDimensions(fit)
  const holdingBack = holdingBackLine(fit)
  // Strongest dimension the candidate can actually LEAD WITH (excludes employer/comp/location, which
  // aren't candidate strengths even at 100/100). Drives the dynamic "lead with" next step.
  const leadDim = leadDimension(fit)

  // Keyword/ATS coverage from the extracted skill signals.
  const held = new Set(fitInput.candidateSkills.map((s) => s.toLowerCase().trim()))
  const adj = new Set((fitInput.adjacentSkills ?? []).map((s) => s.toLowerCase().trim()))
  const coverageOf = (skills: string[]) =>
    skills.map((skill) => {
      const k = skill.toLowerCase().trim()
      const status: Status = held.has(k) ? 'is-pass' : adj.has(k) ? 'is-warn' : 'is-fail'
      return { skill, status }
    })
  // Required must-haves drive the fit score; preferred (nice-to-have) keywords are shown separately
  // and explicitly DON'T affect the score, so a candidate isn't penalized for missing a bonus skill.
  const coverage = coverageOf(fitInput.mustHaveSkills)
  const preferredCoverage = coverageOf(fitInput.preferredSkills ?? [])
  // The next steps below derive from the fit data, so the list varies per packet: the top hard gap and
  // the first must-have the candidate doesn't clearly have are both actionable, role-specific advice.
  const topGap = fit.hardGaps[0]
  const missingSkill = coverage.find((c) => c.status === 'is-fail')?.skill

  // Move focus to the packet heading once it renders, so keyboard/screen-reader users land on the
  // result instead of staying on the submit button above. tabIndex=-1 makes the heading focusable
  // without adding it to the tab order.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    // A <section>, not a nested <main>: the page already owns the single main landmark, and the
    // packet's top heading is an <h2> under the page <h1>. Labelled by that heading.
    <section className="packet" aria-labelledby="pk-title">
      <header className="topbar">
        <p className="kicker">ScoutLane · Application Packet</p>
        <h2 id="pk-title" tabIndex={-1} ref={headingRef}>
          {heading}
        </h2>
        <p className="gen">Assembled from your structured history · tailored to your ATS-safe template</p>
        <p className="gen">
          Style: {styleLabel.theme} · {styleLabel.font}
          {style.source === 'recommended' ? ' (recommended)' : style.source === 'user' ? ' (your pick)' : ''}
          {styleWhy ? ` · ${styleWhy}` : ''}
        </p>
      </header>

      <div className="packet__body">
        {/* Main column: the fit analysis (role, gauge + dimensions, keyword coverage). */}
        <div className="packet__col packet__col--main">
        <section className="card" aria-labelledby="pk-role">
          <h3 id="pk-role">Role</h3>
          {pills.length > 0 && (
            <ul className="pill-row">
              {pills.map((p) => (
                <li key={p} className="pill">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card fit-card" aria-labelledby="pk-fit">
          <h3 id="pk-fit">Fit assessment</h3>
          <div className="gauge-row">
            <div
              className="gauge"
              style={{ '--value': fit.overall } as VarStyle}
              role="meter"
              aria-valuenow={fit.overall}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${bandLabel(fit.band)}, ${fit.overall} out of 100`}
              aria-label="Overall fit score"
            >
              <span className="gauge__inner" aria-hidden="true">
                <span className="gauge__num">{fit.overall}</span>
                <span className="gauge__den">/ 100</span>
              </span>
            </div>
            <div className="fit-headline">
              <p className="fit-band">
                <strong>{bandLabel(fit.band)}.</strong> {bandSummary(fit.band)}
              </p>
              {holdingBack && <p className="fit-holdback">{holdingBack}</p>}
            </div>
          </div>

          {friendly && (
            <div className="fit-review" role="status">
              <p className="fit-review__title">
                <StatusIcon status="is-warn" /> Held back for review
              </p>
              <p className="fit-review__lead">
                {friendly.title}. This score still reflects your fit, but the tailored documents are
                on hold until the flagged items are resolved, so treat it as a signal to act on, not a
                finished packet.
              </p>
              {friendly.reasons.length > 0 && (
                <ul className="tight fit-review__reasons">
                  {friendly.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <MeterGroup title="Your strengths" dims={strengths} emptyHint="No standout strengths for this role yet." />
          <MeterGroup title="Worth shoring up" dims={stretches} />
          <MeterGroup title="Not assessed" dims={notAssessed} />

          {fit.hardGaps.length > 0 && (
            <div className="fit-gaps" role="note">
              <p className="fit-gaps__title">Gaps to address before applying</p>
              <ul className="tight">
                {fit.hardGaps.map((g) => (
                  <li key={`gap-${g}`}>{g}.</li>
                ))}
              </ul>
            </div>
          )}

          <p className="fit-trust">
            This fit assessment is just for you, to help you decide whether to apply. It stays private,
            separate from the resume and cover letter you download.
          </p>
        </section>

        </div>

        {/* Aside column: the act-on-it cards (documents, outreach, next steps). */}
        <div className="packet__col packet__col--aside">
        <section className="card" aria-labelledby="pk-docs">
          <h3 id="pk-docs">Documents &amp; checks</h3>
          <ul className="pill-row" aria-label="Guardrail checks">
            <li>
              <span className={`badge ${guardrails.noFabrication.ok ? 'is-pass' : 'is-fail'}`}>
                <StatusIcon status={guardrails.noFabrication.ok ? 'is-pass' : 'is-fail'} /> No fabrication
              </span>
            </li>
            <li>
              <span className={`badge ${guardrails.bannedTerms.ok ? 'is-pass' : 'is-fail'}`}>
                <StatusIcon status={guardrails.bannedTerms.ok ? 'is-pass' : 'is-fail'} /> Banned terms
              </span>
            </li>
            <li>
              <span className={`badge ${guardrails.style.ok ? 'is-pass' : 'is-fail'}`}>
                <StatusIcon status={guardrails.style.ok ? 'is-pass' : 'is-fail'} /> Style
              </span>
            </li>
            {guardrails.ats && (
              <li>
                <span className={`badge ${guardrails.ats.ok ? 'is-pass' : 'is-fail'}`}>
                  <StatusIcon status={guardrails.ats.ok ? 'is-pass' : 'is-fail'} /> ATS-safe
                </span>
              </li>
            )}
            {!guardrails.certStatus.skipped && (
              <li>
                <span className={`badge ${guardrails.certStatus.ok ? 'is-pass' : 'is-warn'}`}>
                  <StatusIcon status={guardrails.certStatus.ok ? 'is-pass' : 'is-warn'} /> Cert currency
                </span>
              </li>
            )}
          </ul>
          {guardrails.certStatus.suspicious.length > 0 && (
            <p className="callout">
              <b>Check cert currency:</b> the source resume looks to list{' '}
              {guardrails.certStatus.suspicious.join(', ')} as previously held, but{' '}
              {guardrails.certStatus.suspicious.length === 1 ? 'it was' : 'they were'} placed under
              Active. Review before sending.
            </p>
          )}
          {documents ? (
            <>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: '12.5px' }}>
                Your packet, download each as a PDF (opens anywhere) or an editable Word file (DOCX):
              </p>
              <div className="downloads">
                <DocButton formats={documents.fitAssessment} label="fit assessment" />
                <DocButton formats={documents.resume} label="résumé" />
                <DocButton formats={documents.coverLetter} label="cover letter" />
              </div>
              {sourceUrl && (
                <p style={{ margin: '12px 0 0' }}>
                  <a className="apply-btn" href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    Apply to this posting ↗
                  </a>
                </p>
              )}
            </>
          ) : (
            <p className="muted">A guardrail blocked this packet, so no documents were generated.</p>
          )}
        </section>

        {documents && tailored.outreach && (
          <details className="card">
            <summary>
              <h3 style={{ display: 'inline' }}>Reach the hiring manager</h3>
            </summary>
            <p className="muted" style={{ margin: '6px 0 4px', fontSize: '12.5px' }}>
              Two ready-to-send openers, built from the same facts as your packet. Personalize before
              sending.
            </p>
            <div className="outreach-item">
              <div className="outreach-head">
                <span className="outreach-label">
                  LinkedIn connection note{' '}
                  <span className="outreach-count">{tailored.outreach.linkedin.length}/300</span>
                </span>
                <CopyButton text={tailored.outreach.linkedin} label="note" />
              </div>
              <p className="outreach-text">{tailored.outreach.linkedin}</p>
            </div>
            <div className="outreach-item">
              <div className="outreach-head">
                <span className="outreach-label">Outreach email</span>
                <CopyButton text={tailored.outreach.email} label="email" />
              </div>
              <p className="outreach-text">{tailored.outreach.email}</p>
            </div>
          </details>
        )}

        <section className="card" aria-labelledby="pk-next">
          <h3 id="pk-next">Next steps</h3>
          <ol className="steps">
            <li>Skim the tailored resume and cover letter for anything you&apos;d phrase differently.</li>
            <li>
              {sourceUrl ? (
                <>
                  Apply through{' '}
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    the validated posting ↗
                  </a>
                  , not an aggregator, so you land in their ATS directly.
                </>
              ) : (
                'Apply through the validated posting, not an aggregator, so you land in their ATS directly.'
              )}
            </li>
            {leadDim && (
              <li>
                Lead with your strongest area, {leadDim.label} ({leadDim.score}/100), in your outreach and
                cover letter: it&apos;s your sharpest differentiator for this role.
              </li>
            )}
            {topGap && (
              <li>
                Get ahead of the gap: be ready to speak to {topGap}, naming a transferable experience
                rather than skipping over it.
              </li>
            )}
            {missingSkill && (
              <li>
                The posting asks for {missingSkill}, which isn&apos;t clear in your background. Lead with
                adjacent experience instead of claiming it.
              </li>
            )}
          </ol>
        </section>
        </div>

        {/* Keyword & ATS coverage spans the FULL width below the two columns: the required and
            preferred tables need more room than the half-width left column, so placing them here
            lets the two-up grid sit side by side again instead of stacking. */}
        {(coverage.length > 0 || preferredCoverage.length > 0) && (
          <div className="grid-2 packet__wide">
            {coverage.length > 0 && (
              <CoverageCard
                id="pk-kw"
                title="Keyword & ATS coverage"
                skillHeader="Required skill"
                rows={coverage}
                footer={
                  <p className="callout">
                    <b>The honest part:</b> tailoring only resurfaces facts genuinely in your history, the
                    no-fabrication guardrail {guardrails.noFabrication.ok ? 'passed' : 'flagged this packet'}.
                    Nothing here is invented.
                  </p>
                }
              />
            )}

            {preferredCoverage.length > 0 && (
              <CoverageCard
                id="pk-kw-pref"
                title="Preferred keywords (nice-to-have)"
                skillHeader="Preferred skill"
                rows={preferredCoverage}
                intro="These are the role's preferred, bonus skills. They help with ATS keyword matching, but they do NOT affect your fit score, so a gap here is not a strike against you."
              />
            )}
          </div>
        )}
      </div>

      <footer>
        <p className="foot">ScoutLane · validated fit → tailored, truthful, ATS-safe documents.</p>
      </footer>
    </section>
  )
}

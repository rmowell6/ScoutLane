'use client'

// Accessible Application Packet view (UI_UX_SPEC.md / packet.template.html). A pure render of the
// deterministic FitResult + tailored content — no scoring logic here. Semantics per the spec:
// one <h1>, sections labelled by their <h2>, role="meter" for the gauge and sub-score bars (never
// progressbar), status conveyed by text + icon (never color alone), WCAG 2.2 AA tokens.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Packet, DocumentRef } from '@/lib/services/buildPacket'
import type { FitDimension } from '@/lib/fit/fitScore'
import { packetSkinVars, styleNames } from '@/lib/style/skin'
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

function bandSummary(band: string): string {
  switch (band) {
    case 'Best fit':
      return 'A bullseye match — apply with a tailored packet.'
    case 'Strong fit':
      return 'A strong match with honest stretches — worth applying.'
    case 'Stretch':
      return 'A stretch — apply only if you can close the flagged gaps.'
    default:
      return 'A reach for now — weigh against roles that match more of your background.'
  }
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
  // The role="meter" sits on the bar itself, not the wrapper: a meter is a leaf role, so prose
  // placed inside it (the note) isn't reliably exposed. Keep the note a sibling and wire it in via
  // aria-describedby so screen readers announce "<label>: N of 100" plus the explanation.
  const noteId = `meter-note-${d.key}`
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
        {d.note}
      </p>
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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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
    const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }))
    trigger(url)
    // Revoking on a 0ms timer can race the browser's own fetch of the blob and abort the download
    // (notably in Firefox). Hold the URL for a comfortable window — the docx is a few KB — then free it.
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

/** A download button that clearly reads as a download, with a brief confirmation on click. */
function DocButton({ doc, label }: { doc: DocumentRef; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="download-btn"
      onClick={() => {
        downloadDoc(doc)
        // Activation funnel: downloading a tailored doc is the "opened a packet" signal.
        track(EVENTS.packetOpened, { doc: label })
        setDone(true)
        setTimeout(() => setDone(false), 2500)
      }}
    >
      <DownloadIcon />
      {done ? `Downloaded ${label} ✓` : `Download ${label}`}
    </button>
  )
}

export default function PacketView({ packet, sourceUrl }: { packet: Packet; sourceUrl?: string | null }) {
  const { fit, fitInput, jobReqs, guardrails, documents, style, styleWhy } = packet
  const roleTitle = jobReqs.title ?? 'Target role'
  const heading = jobReqs.company ? `${jobReqs.company} — ${roleTitle}` : roleTitle

  // Re-skin the preview to the style the documents were built with, so the on-screen packet matches
  // the .docx. Status colors stay fixed (handled in packet.css); only brand/accent/wash/font shift.
  const skin = packetSkinVars(style.theme, style.font) as CSSProperties
  const styleLabel = styleNames(style.theme, style.font)

  const pills = [
    jobReqs.comp,
    jobReqs.location ?? humanize(fitInput.location),
    `${humanize(fitInput.employerType)} employer`,
  ].filter((p): p is string => Boolean(p))

  // Why / watch derived from the deterministic dimensions (highest = strengths, lowest = risks).
  const sorted = [...fit.dimensions].sort((a, b) => b.score - a.score)
  const strengths = sorted.filter((d) => d.score >= 75).slice(0, 3)
  const risks = sorted.filter((d) => d.score < 60).reverse().slice(0, 3)

  // Keyword/ATS coverage from the extracted skill signals.
  const held = new Set(fitInput.candidateSkills.map((s) => s.toLowerCase().trim()))
  const adj = new Set((fitInput.adjacentSkills ?? []).map((s) => s.toLowerCase().trim()))
  const coverage = fitInput.mustHaveSkills.map((skill) => {
    const k = skill.toLowerCase().trim()
    const status: Status = held.has(k) ? 'is-pass' : adj.has(k) ? 'is-warn' : 'is-fail'
    return { skill, status }
  })

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
    <section className="packet" style={skin} aria-labelledby="pk-title">
      <header className="topbar">
        <p className="kicker">ScoutLane · Application Packet</p>
        <h2 id="pk-title" tabIndex={-1} ref={headingRef}>
          {heading}
        </h2>
        <p className="gen">Assembled from your structured history · tailored to your ATS-safe template</p>
        <p className="gen">
          Style: {styleLabel.theme} · {styleLabel.font}
          {style.source === 'recommended' ? ' (recommended)' : style.source === 'user' ? ' (your pick)' : ''}
          {styleWhy ? ` — ${styleWhy}` : ''}
        </p>
      </header>

      <div className="packet__body">
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
          <p className="muted" style={{ margin: '.2em 0' }}>
            Deterministic fit assessment (rubric {fit.version}).
          </p>
        </section>

        <section className="card" aria-labelledby="pk-fit">
          <h3 id="pk-fit">Fit assessment</h3>
          <div className="gauge-row">
            <div
              className="gauge"
              style={{ '--value': fit.overall } as VarStyle}
              role="meter"
              aria-valuenow={fit.overall}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${fit.band}, ${fit.overall} out of 100`}
              aria-label="Overall fit score"
            >
              <span className="gauge__inner" aria-hidden="true">
                <span className="gauge__num">{fit.overall}</span>
                <span className="gauge__den">/ 100</span>
              </span>
            </div>
            <p style={{ fontSize: '13px', margin: 0 }}>
              <strong>{fit.band}.</strong> {bandSummary(fit.band)}{' '}
              <span className="muted">
                Weighted base {fit.base}, bonus +{fit.bonus}, penalties −{fit.penaltyTotal}.
              </span>
            </p>
          </div>
          {fit.dimensions.map((d) => (
            <Meter key={d.key} d={d} />
          ))}
        </section>

        {(strengths.length > 0 || risks.length > 0) && (
          <div className="grid-2">
            <section className="card" aria-labelledby="pk-why">
              <h3 id="pk-why">Why you fit</h3>
              {strengths.length > 0 ? (
                <ul className="tight">
                  {strengths.map((d) => (
                    <li key={d.key}>
                      <strong>{d.label}.</strong> {d.note}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No standout strengths surfaced for this role.</p>
              )}
            </section>
            <section className="card" aria-labelledby="pk-watch">
              <h3 id="pk-watch">Watch-outs</h3>
              {risks.length > 0 || fit.hardGaps.length > 0 ? (
                <ul className="tight">
                  {risks.map((d) => (
                    <li key={d.key}>
                      <strong>{d.label}.</strong> {d.note}
                    </li>
                  ))}
                  {fit.hardGaps.map((g) => (
                    <li key={`gap-${g}`}>
                      <strong>Hard gap:</strong> {g}.
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No material gaps flagged.</p>
              )}
            </section>
          </div>
        )}

        {coverage.length > 0 && (
          <section className="card" aria-labelledby="pk-kw">
            <h3 id="pk-kw">Keyword &amp; ATS coverage</h3>
            <table className="data-table" aria-labelledby="pk-kw">
              <thead>
                <tr>
                  <th scope="col">Required skill</th>
                  <th scope="col">Your coverage</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map(({ skill, status }) => (
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
            <p className="callout">
              <b>The honest part:</b> tailoring only resurfaces facts genuinely in your history — the
              no-fabrication guardrail {guardrails.noFabrication.ok ? 'passed' : 'flagged this packet'}.
              Nothing here is invented.
            </p>
          </section>
        )}

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
              <p className="muted" style={{ margin: '0 0 8px', fontSize: '12.5px' }}>
                Your packet — click to download each Word file (.docx):
              </p>
              <div className="downloads">
                <DocButton doc={documents.fitAssessment} label="fit assessment" />
                <DocButton doc={documents.resume} label="résumé" />
                <DocButton doc={documents.coverLetter} label="cover letter" />
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
            <li>Lead with your strongest dimension above — it&apos;s your sharpest differentiator.</li>
          </ol>
        </section>
      </div>

      <footer>
        <p className="foot">ScoutLane · validated fit → tailored, truthful, ATS-safe documents.</p>
      </footer>
    </section>
  )
}

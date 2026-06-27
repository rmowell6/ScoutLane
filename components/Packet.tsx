'use client'

// Accessible Application Packet view (UI_UX_SPEC.md / packet.template.html). A pure render of the
// deterministic FitResult + tailored content — no scoring logic here. Semantics per the spec:
// one <h1>, sections labelled by their <h2>, role="meter" for the gauge and sub-score bars (never
// progressbar), status conveyed by text + icon (never color alone), WCAG 2.2 AA tokens.
import type { CSSProperties } from 'react'
import type { Packet, DocumentRef } from '@/lib/services/buildPacket'
import type { FitDimension } from '@/lib/fit/fitScore'

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
  return (
    <div
      className={`meter ${status}`}
      role="meter"
      aria-valuenow={d.score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${d.label}: ${d.score} of 100`}
    >
      <div className="meter__top">
        <span className="meter__label">{d.label}</span>
        <span className="meter__val" aria-hidden="true">
          {d.score}
        </span>
      </div>
      <div className="meter__track" aria-hidden="true">
        <div className="meter__fill" style={{ '--value': d.score } as VarStyle} />
      </div>
      <p className="meter__note">{d.note}</p>
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
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export default function PacketView({ packet }: { packet: Packet }) {
  const { fit, fitInput, jobReqs, guardrails, documents } = packet
  const roleTitle = jobReqs.title ?? 'Target role'
  const heading = jobReqs.company ? `${jobReqs.company} — ${roleTitle}` : roleTitle

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

  return (
    <div className="packet">
      <header className="topbar">
        <p className="kicker">ScoutLane · Application Packet</p>
        <h1>{heading}</h1>
        <p className="gen">Assembled from your structured history · tailored to your ATS-safe template</p>
      </header>

      <main>
        <section className="card" aria-labelledby="pk-role">
          <h2 id="pk-role">Role</h2>
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
          <h2 id="pk-fit">Fit assessment</h2>
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
              <h2 id="pk-why">Why you fit</h2>
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
              <h2 id="pk-watch">Watch-outs</h2>
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
            <h2 id="pk-kw">Keyword &amp; ATS coverage</h2>
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
          <h2 id="pk-docs">Documents &amp; checks</h2>
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
          </ul>
          {documents ? (
            <div className="downloads">
              <button type="button" className="download-btn" onClick={() => downloadDoc(documents.fitAssessment)}>
                Fit assessment (.docx)
              </button>
              <button type="button" className="download-btn" onClick={() => downloadDoc(documents.resume)}>
                Resume (.docx)
              </button>
              <button type="button" className="download-btn" onClick={() => downloadDoc(documents.coverLetter)}>
                Cover letter (.docx)
              </button>
            </div>
          ) : (
            <p className="muted">A guardrail blocked this packet, so no documents were generated.</p>
          )}
        </section>

        <section className="card" aria-labelledby="pk-next">
          <h2 id="pk-next">Next steps</h2>
          <ol className="steps">
            <li>Skim the tailored resume and cover letter for anything you&apos;d phrase differently.</li>
            <li>Apply through the validated posting, not an aggregator, so you land in their ATS directly.</li>
            <li>Lead with your strongest dimension above — it&apos;s your sharpest differentiator.</li>
          </ol>
        </section>
      </main>

      <footer>
        <p className="foot">ScoutLane · validated fit → tailored, truthful, ATS-safe documents.</p>
      </footer>
    </div>
  )
}

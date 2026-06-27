'use client'

// Packet UI — the human-facing side of the hero pipeline (M1 definition of done).
// Paste a resume + a JD, POST to /api/packet, then render the fit assessment, the
// guardrail verdict, and download buttons for the two tailored .docx files.
// This is a thin client: all generation and the no-fabrication guardrail live server-side.
import { useState } from 'react'
import type { Packet, DocumentRef } from '@/lib/services/buildPacket'
import styles from './page.module.css'

/** Error shapes the route can return (400 invalid body, 422 guardrail, 500 step failure). */
interface ApiError {
  error: string
  reasons?: string[]
  step?: string | null
  message?: string
}

const SAMPLE_RESUME =
  'Ryan Mowell — Cloud Engineer\nLebanon, OH · ryan@example.com\n\n' +
  'Skills: Azure, VMware, Veeam, PowerShell, Microsoft Sentinel, Azure Virtual Desktop\n\n' +
  'Experience:\nSignature Performance — Cloud Engineer (2024–present)\n' +
  '- Built and ran hybrid Azure infrastructure under HIPAA compliance\n' +
  '- Deployed Microsoft Sentinel for security monitoring across the estate\n' +
  '- Rolled out Azure Virtual Desktop for remote staff\n\n' +
  'Certifications: VMware Certified Professional - Data Center Virtualization (VCP-DCV)'

const SAMPLE_JD =
  'Senior Cloud Engineer.\nMust have: Azure, VMware, security monitoring.\nNice to have: Terraform.'

export default function Home() {
  const [resumeText, setResumeText] = useState('')
  const [jdText, setJdText] = useState('')
  const [loading, setLoading] = useState(false)
  const [packet, setPacket] = useState<Packet | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setPacket(null)
    setError(null)
    try {
      const res = await fetch('/api/packet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jdText }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // Surface the route's structured diagnostics (reasons / step / message) verbatim.
        setError(
          (data as ApiError | null) ?? { error: `Request failed (${res.status})` },
        )
        return
      }
      setPacket(data as Packet)
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  function loadSample() {
    setResumeText(SAMPLE_RESUME)
    setJdText(SAMPLE_JD)
  }

  const canSubmit = resumeText.trim().length > 0 && jdText.trim().length > 0 && !loading

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>ScoutLane</h1>
          <p className={styles.tagline}>
            Paste a resume and a job description. Get a fit assessment plus a tailored,
            ATS-safe resume and cover letter — built only from facts in the resume, with a
            code-enforced no-fabrication guardrail.
          </p>
        </header>

        <form className={styles.form} onSubmit={generate}>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.label}>Resume</span>
              <textarea
                className={styles.textarea}
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste the candidate's resume text…"
                rows={16}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Job description</span>
              <textarea
                className={styles.textarea}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the target job description…"
                rows={16}
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={!canSubmit}>
              {loading ? 'Generating packet…' : 'Generate packet'}
            </button>
            <button
              className={styles.secondary}
              type="button"
              onClick={loadSample}
              disabled={loading}
            >
              Load sample
            </button>
          </div>
        </form>

        {error && <ErrorPanel error={error} />}
        {packet && <PacketResult packet={packet} />}
      </main>
    </div>
  )
}

function ErrorPanel({ error }: { error: ApiError }) {
  return (
    <section className={`${styles.panel} ${styles.errorPanel}`} role="alert">
      <h2 className={styles.panelTitle}>{error.error}</h2>
      {error.reasons && error.reasons.length > 0 && (
        <ul className={styles.reasons}>
          {error.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {error.step && (
        <p className={styles.errorMeta}>
          Failed step: <code>{error.step}</code>
        </p>
      )}
      {error.message && <p className={styles.errorMeta}>{error.message}</p>}
    </section>
  )
}

function PacketResult({ packet }: { packet: Packet }) {
  const { fit, guardrails, documents } = packet
  return (
    <section className={styles.panel}>
      <div className={styles.scoreRow}>
        <div className={styles.scoreBadge}>
          <span className={styles.scoreNumber}>{fit.overall}</span>
          <span className={styles.scoreOutOf}>/ 100</span>
        </div>
        <div className={styles.scoreSubs}>
          {fit.subs.map((s) => (
            <div key={s.label} className={styles.sub}>
              <span className={styles.subLabel}>{s.label}</span>
              <span className={styles.subScore}>{s.score}</span>
              <span className={styles.subNote}>{s.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.guardrails}>
        <GuardrailBadge ok={guardrails.noFabrication.ok} label="No fabrication" />
        <GuardrailBadge ok={guardrails.bannedTerms.ok} label="Banned terms" />
        <GuardrailBadge ok={guardrails.style.ok} label="Style" />
        {guardrails.ats && <GuardrailBadge ok={guardrails.ats.ok} label="ATS-safe" />}
      </div>

      {documents ? (
        <div className={styles.downloads}>
          <DownloadButton doc={documents.resume} label="Download resume (.docx)" />
          <DownloadButton doc={documents.coverLetter} label="Download cover letter (.docx)" />
        </div>
      ) : (
        <p className={styles.errorMeta}>
          A guardrail blocked this packet, so no documents were generated.
        </p>
      )}
    </section>
  )
}

function GuardrailBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`${styles.badge} ${ok ? styles.badgeOk : styles.badgeFail}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  )
}

/** Download a returned doc: use the Supabase signed URL, else decode the inline base64. */
function DownloadButton({ doc, label }: { doc: DocumentRef; label: string }) {
  function handle() {
    if (doc.signedUrl) {
      triggerDownload(doc.signedUrl, doc.filename)
      return
    }
    if (doc.base64) {
      const url = base64ToObjectUrl(doc.base64)
      triggerDownload(url, doc.filename)
      // Revoke on the next tick so the click has been handled.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }
  return (
    <button className={styles.download} type="button" onClick={handle}>
      {label}
    </button>
  )
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function base64ToObjectUrl(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }))
}

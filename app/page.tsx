'use client'

// Packet UI — the human-facing side of the hero pipeline (M1 definition of done).
// Paste a resume + a JD, POST to /api/packet, then render the fit assessment, the
// guardrail verdict, and download buttons for the two tailored .docx files.
// This is a thin client: all generation and the no-fabrication guardrail live server-side.
import { useEffect, useState } from 'react'
import type { Packet, DocumentRef } from '@/lib/services/buildPacket'
import { fitBand, humanizeCode } from '@/lib/fit'
import styles from './page.module.css'

/** A saved profile + the resume snapshot it was structured from (for staleness detection). */
interface SavedProfile {
  id: string
  resume: string
}
const SAVED_KEY = 'scoutlane.savedProfile'

/** Error shapes the route can return (400 invalid body, 422 guardrail, 500 step failure). */
interface ApiError {
  error: string
  reasons?: string[]
  step?: string | null
  message?: string
}

/** A pooled job from /api/jobs (light list shape). */
interface PooledJob {
  id: string
  provider: string
  title: string
  company: string
  location: string | null
  url: string
}

type JdMode = 'paste' | 'pick'

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
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedProfile | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileNote, setProfileNote] = useState<string | null>(null)
  const [jdMode, setJdMode] = useState<JdMode>('paste')
  const [jobQuery, setJobQuery] = useState('')
  const [jobResults, setJobResults] = useState<PooledJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsNote, setJobsNote] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<PooledJob | null>(null)

  // Load/search the job pool while in "pick" mode. Debounced; runs on entering pick mode and on
  // each query change. setState lands inside the async callback (not the effect body), so it
  // doesn't trip the synchronous-setState lint rule.
  useEffect(() => {
    if (jdMode !== 'pick') return
    const q = jobQuery.trim()
    const handle = setTimeout(async () => {
      setJobsLoading(true)
      setJobsNote(null)
      try {
        const res = await fetch(`/api/jobs?${new URLSearchParams(q ? { q } : {}).toString()}`)
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setJobsNote((data?.message as string) ?? (data?.error as string) ?? `Failed to load jobs (${res.status})`)
          setJobResults([])
          return
        }
        setJobResults((data as { jobs: PooledJob[] }).jobs)
      } catch (err) {
        setJobsNote(err instanceof Error ? err.message : 'Failed to load jobs')
        setJobResults([])
      } finally {
        setJobsLoading(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [jdMode, jobQuery])

  // Rehydrate a previously saved profile (id + its source resume) on first load. This must run
  // post-mount, not in a lazy initializer: the page is statically prerendered with no
  // localStorage, so reading it during render would cause an SSR/hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as SavedProfile
      if (parsed?.id && typeof parsed.resume === 'string') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time rehydration from localStorage
        setSaved(parsed)
        setResumeText(parsed.resume)
      }
    } catch {
      // ignore corrupt/unavailable storage
    }
  }, [])

  // The saved profile is "live" only while the resume text still matches what it was built from.
  const reuseActive = saved !== null && saved.resume === resumeText

  async function saveProfile() {
    setSavingProfile(true)
    setProfileNote(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setProfileNote((data?.message as string) ?? (data?.error as string) ?? `Save failed (${res.status})`)
        return
      }
      const next: SavedProfile = { id: (data as { profileId: string }).profileId, resume: resumeText }
      setSaved(next)
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next))
      } catch {
        // non-fatal: reuse still works this session
      }
      setProfileNote('Profile saved. Future generations reuse it without re-structuring.')
    } catch (err) {
      setProfileNote(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  function clearSaved() {
    setSaved(null)
    setProfileNote(null)
    try {
      localStorage.removeItem(SAVED_KEY)
    } catch {
      // ignore
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setPacket(null)
    setError(null)
    try {
      // Resume: reuse the saved profile when the text is unchanged; else send raw text.
      const resumePart = reuseActive ? { profileId: saved.id } : { resumeText }
      // JD: a picked pooled job sends its id; otherwise the pasted text.
      const jdPart = jdMode === 'pick' && selectedJob ? { jobId: selectedJob.id } : { jdText }
      const payload = { ...resumePart, ...jdPart }
      const res = await fetch('/api/packet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setUploading(true)
    setUploadNote(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/extract', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setUploadNote((data?.message as string) ?? (data?.error as string) ?? `Upload failed (${res.status})`)
        return
      }
      setResumeText((data as { text: string }).text)
      setUploadNote(`Loaded ${file.name} (${(data as { chars: number }).chars.toLocaleString()} chars) — review and edit below.`)
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const jdReady = jdMode === 'pick' ? selectedJob !== null : jdText.trim().length > 0
  const canSubmit = resumeText.trim().length > 0 && jdReady && !loading

  function pickMode(mode: JdMode) {
    setJdMode(mode)
    if (mode === 'paste') setSelectedJob(null)
  }

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
              <span className={styles.labelRow}>
                <span className={styles.label}>Resume</span>
                <span className={styles.upload}>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={onFile}
                    disabled={uploading || loading}
                  />
                  {uploading && <span className={styles.uploadStatus}>Extracting…</span>}
                </span>
              </span>
              <textarea
                className={styles.textarea}
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste the resume text, or upload a PDF / DOCX / TXT above…"
                rows={16}
              />
              {uploadNote && <span className={styles.uploadNote}>{uploadNote}</span>}
            </label>
            <div className={styles.field}>
              <span className={styles.labelRow}>
                <span className={styles.label}>Job description</span>
                <span className={styles.toggle}>
                  <button
                    type="button"
                    className={jdMode === 'paste' ? styles.toggleOn : styles.toggleOff}
                    onClick={() => pickMode('paste')}
                  >
                    Paste
                  </button>
                  <button
                    type="button"
                    className={jdMode === 'pick' ? styles.toggleOn : styles.toggleOff}
                    onClick={() => pickMode('pick')}
                  >
                    Pick from pool
                  </button>
                </span>
              </span>

              {jdMode === 'paste' ? (
                <textarea
                  className={styles.textarea}
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder="Paste the target job description…"
                  rows={16}
                />
              ) : (
                <div className={styles.picker}>
                  <input
                    className={styles.search}
                    type="search"
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Search roles by title or company…"
                  />
                  {selectedJob && (
                    <div className={styles.selectedJob}>
                      <span>
                        <strong>{selectedJob.title}</strong> — {selectedJob.company}
                        {selectedJob.location ? ` · ${selectedJob.location}` : ''}
                      </span>
                      <button type="button" className={styles.clearLink} onClick={() => setSelectedJob(null)}>
                        clear
                      </button>
                    </div>
                  )}
                  <ul className={styles.jobList}>
                    {jobsLoading && <li className={styles.jobMeta}>Loading…</li>}
                    {!jobsLoading && jobResults.length === 0 && (
                      <li className={styles.jobMeta}>{jobsNote ?? 'No roles found.'}</li>
                    )}
                    {jobResults.map((job) => (
                      <li key={job.id}>
                        <button
                          type="button"
                          className={selectedJob?.id === job.id ? styles.jobItemOn : styles.jobItem}
                          onClick={() => setSelectedJob(job)}
                        >
                          <span className={styles.jobTitle}>{job.title}</span>
                          <span className={styles.jobSub}>
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
            {!reuseActive ? (
              <button
                className={styles.secondary}
                type="button"
                onClick={saveProfile}
                disabled={savingProfile || loading || resumeText.trim().length === 0}
              >
                {savingProfile ? 'Saving profile…' : 'Save profile for reuse'}
              </button>
            ) : (
              <span className={styles.reuseBadge}>
                ✓ Reusing saved profile
                <button type="button" className={styles.clearLink} onClick={clearSaved}>
                  clear
                </button>
              </span>
            )}
          </div>
          {profileNote && <span className={styles.uploadNote}>{profileNote}</span>}
          {saved && !reuseActive && (
            <span className={styles.uploadNote}>
              Resume edited since save — this run will re-structure. Save again to reuse.
            </span>
          )}
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
  const { fit, tailored, jobReqs, guardrails, documents } = packet
  const { band, recommendation } = fitBand(fit.overall)
  const roleLine = [jobReqs.title, jobReqs.company].filter(Boolean).join('  ·  ')
  const coverParagraphs = tailored.coverLetter
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <section className={styles.panel}>
      {/* Fit assessment */}
      <div className={styles.fitHead}>
        <div className={styles.scoreBadge}>
          <span className={styles.scoreNumber}>{fit.overall}</span>
          <span className={styles.scoreOutOf}>/ 100</span>
        </div>
        <div className={styles.fitSummary}>
          <span className={styles.fitBand}>{band}</span>
          {roleLine && <span className={styles.fitRole}>{roleLine}</span>}
          <p className={styles.fitRecommendation}>{recommendation}</p>
        </div>
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

      {fit.reasonCodes.length > 0 && (
        <div className={styles.reasonCodes}>
          {fit.reasonCodes.map((c) => (
            <span key={c} className={styles.reasonChip}>
              {humanizeCode(c)}
            </span>
          ))}
        </div>
      )}

      <div className={styles.guardrails}>
        <GuardrailBadge ok={guardrails.noFabrication.ok} label="No fabrication" />
        <GuardrailBadge ok={guardrails.bannedTerms.ok} label="Banned terms" />
        <GuardrailBadge ok={guardrails.style.ok} label="Style" />
        {guardrails.ats && <GuardrailBadge ok={guardrails.ats.ok} label="ATS-safe" />}
      </div>

      {/* Tailored content preview — every claim traces to a profile fact (guardrail enforced). */}
      <div className={styles.preview}>
        <h3 className={styles.previewHead}>Tailored summary</h3>
        <p className={styles.previewBody}>{tailored.summary}</p>

        {tailored.skills.length > 0 && (
          <>
            <h3 className={styles.previewHead}>Skills</h3>
            <div className={styles.skillChips}>
              {tailored.skills.map((s) => (
                <span key={s} className={styles.skillChip}>
                  {s}
                </span>
              ))}
            </div>
          </>
        )}

        {tailored.claims.length > 0 && (
          <>
            <h3 className={styles.previewHead}>Key achievements</h3>
            <ul className={styles.claimList}>
              {tailored.claims.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
          </>
        )}

        {coverParagraphs.length > 0 && (
          <>
            <h3 className={styles.previewHead}>Cover letter</h3>
            <div className={styles.coverPreview}>
              {coverParagraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </>
        )}
      </div>

      {documents ? (
        <div className={styles.downloads}>
          <DownloadButton doc={documents.fitAssessment} label="Download fit assessment (.docx)" />
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

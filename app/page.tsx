'use client'

// Packet UI — the human-facing side of the hero pipeline (M1 definition of done).
// Paste a resume + a JD, POST to /api/packet, then render the fit assessment, the
// guardrail verdict, and download buttons for the two tailored .docx files.
// This is a thin client: all generation and the no-fabrication guardrail live server-side.
import { useEffect, useState } from 'react'
import type { Packet } from '@/lib/services/buildPacket'
import PacketView from '@/components/Packet'
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

/** A discovered role from /api/discover — a pooled job plus Claude's similarity verdict. */
interface SuggestedRole extends PooledJob {
  score: number
  reason: string
}

type JdMode = 'paste' | 'pick'

// Fully fictional sample persona — no real PII (this string ships to the browser).
const SAMPLE_RESUME =
  'Jordan Rivera — Cloud Engineer\nAustin, TX · jordan.rivera@example.com\n\n' +
  'Skills: Azure, VMware, Veeam, PowerShell, Microsoft Sentinel, Azure Virtual Desktop\n\n' +
  'Experience:\nNorthwind Health — Cloud Engineer (2024–present)\n' +
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
  // The source posting URL the packet was built from (pool path only), so the result links to apply.
  const [packetSourceUrl, setPacketSourceUrl] = useState<string | null>(null)
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
  // Role discovery: similar roles found from the candidate's experience (lexical pre-filter + rerank).
  const [suggested, setSuggested] = useState<SuggestedRole[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoverNote, setDiscoverNote] = useState<string | null>(null)
  // "Pick from pool" has two views: browse (search the full list) and suggestions (AI matches).
  // suggestMode hides the generic list once the user asks for suggestions.
  const [suggestMode, setSuggestMode] = useState(false)
  // Candidate preferences (feed the deterministic fit engine). Target comp + lanes are primary.
  const [targetComp, setTargetComp] = useState('')
  const [targetLanes, setTargetLanes] = useState('')
  const [workMode, setWorkMode] = useState('')
  const [employerPref, setEmployerPref] = useState('')
  const [noGo, setNoGo] = useState('')

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
      const preferences = buildPreferences()
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, ...(preferences ? { preferences } : {}) }),
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

  /** Assemble the preferences payload, or undefined when nothing is set (so the server can fall
   *  back to a saved profile's stored preferences). */
  function buildPreferences(): Record<string, unknown> | undefined {
    const comp = Number(targetComp.replace(/[^0-9.]/g, ''))
    const hasComp = Number.isFinite(comp) && comp > 0
    const lanes = targetLanes.split(',').map((s) => s.trim()).filter(Boolean)
    const noGoLocations = noGo.split(',').map((s) => s.trim()).filter(Boolean)
    if (!hasComp && lanes.length === 0 && !workMode && !employerPref && noGoLocations.length === 0) {
      return undefined
    }
    return {
      targetCompTopUsd: hasComp ? comp : null,
      targetLanes: lanes,
      noGoLocations,
      ...(workMode ? { workMode } : {}),
      ...(employerPref ? { employerTypePreference: employerPref } : {}),
    }
  }

  /** Find similar roles from the candidate's experience (title-variant aware). Needs a resume. */
  async function suggestRoles() {
    setSuggestMode(true) // switch to the suggestions view (hides the generic browse list)
    setDiscovering(true)
    setDiscoverNote(null)
    try {
      const resumePart = reuseActive ? { profileId: saved.id } : { resumeText }
      const preferences = buildPreferences()
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...resumePart, ...(preferences ? { preferences } : {}) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setDiscoverNote((data?.message as string) ?? (data?.error as string) ?? `Discovery failed (${res.status})`)
        setSuggested([])
        return
      }
      const roles = (data as { roles: SuggestedRole[] }).roles
      setSuggested(roles)
      if (roles.length === 0) setDiscoverNote('No similar roles found in the pool yet.')
    } catch (err) {
      setDiscoverNote(err instanceof Error ? err.message : 'Discovery failed')
      setSuggested([])
    } finally {
      setDiscovering(false)
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setPacket(null)
    setPacketSourceUrl(null)
    setError(null)
    try {
      // Resume: reuse the saved profile when the text is unchanged; else send raw text.
      const resumePart = reuseActive ? { profileId: saved.id } : { resumeText }
      // JD: a picked pooled job sends its id; otherwise the pasted text.
      const jdPart = jdMode === 'pick' && selectedJob ? { jobId: selectedJob.id } : { jdText }
      const preferences = buildPreferences()
      const payload = { ...resumePart, ...jdPart, ...(preferences ? { preferences } : {}) }
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
      // Remember the source posting (pool path) so the rendered packet can link straight to apply.
      setPacketSourceUrl(jdMode === 'pick' && selectedJob?.url ? selectedJob.url : null)
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
    setSuggestMode(false) // always land on browse when (re)entering the pool picker
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
                    onChange={(e) => {
                      setJobQuery(e.target.value)
                      setSuggestMode(false) // typing a search returns to browsing the full list
                    }}
                    placeholder="Search roles by title or company…"
                    aria-label="Search roles by title or company"
                    aria-controls="job-results"
                  />

                  <div className={styles.suggestRow}>
                    {!suggestMode ? (
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={suggestRoles}
                        disabled={discovering || resumeText.trim().length === 0}
                        title="Find pool roles similar to your experience, including ones with different titles"
                      >
                        {discovering ? 'Finding similar roles…' : '✨ Suggest roles from my experience'}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={suggestRoles}
                          disabled={discovering || resumeText.trim().length === 0}
                          title="Re-run the suggestions (e.g. after changing your preferences)"
                        >
                          {discovering ? 'Refreshing…' : '↻ Refresh suggestions'}
                        </button>
                        <button type="button" className={styles.clearLink} onClick={() => setSuggestMode(false)}>
                          Browse all roles
                        </button>
                      </>
                    )}
                    {resumeText.trim().length === 0 && !suggestMode && (
                      <span className={styles.jobSub}>Add your resume first.</span>
                    )}
                  </div>
                  <p className={styles.srOnly} role="status">
                    {discovering
                      ? 'Finding roles similar to your experience…'
                      : suggested.length > 0
                        ? `${suggested.length} similar role${suggested.length === 1 ? '' : 's'} found`
                        : ''}
                  </p>
                  {suggestMode && discovering && <span className={styles.jobMeta}>Finding roles…</span>}
                  {suggestMode && !discovering && discoverNote && (
                    <span className={styles.jobMeta}>{discoverNote}</span>
                  )}
                  {suggestMode && suggested.length > 0 && (
                    <span className={styles.jobSub}>
                      AI-suggested matches based on your experience — review each posting before applying.
                    </span>
                  )}
                  {suggestMode && suggested.length > 0 && (
                    <ul className={styles.jobList} aria-label="Suggested roles from your experience">
                      {suggested.map((job) => (
                        <li key={`sug-${job.id}`} className={styles.jobRow}>
                          <button
                            type="button"
                            className={selectedJob?.id === job.id ? styles.jobItemOn : styles.jobItem}
                            onClick={() => setSelectedJob(job)}
                            aria-pressed={selectedJob?.id === job.id}
                          >
                            <span className={styles.jobTitle}>
                              <span className={styles.suggestScore}>{job.score}</span> {job.title}
                            </span>
                            <span className={styles.jobSub}>
                              {job.company}
                              {job.location ? ` · ${job.location}` : ''}
                            </span>
                            <span className={styles.suggestReason}>{job.reason}</span>
                          </button>
                          {job.url && (
                            <a
                              className={styles.sourceLink}
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View original posting ↗
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {selectedJob && (
                    <div className={styles.selectedJob}>
                      <span>
                        <strong>{selectedJob.title}</strong> — {selectedJob.company}
                        {selectedJob.location ? ` · ${selectedJob.location}` : ''}
                      </span>
                      <span className={styles.selectedJobActions}>
                        {selectedJob.url && (
                          <a
                            className={styles.sourceLink}
                            href={selectedJob.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View posting ↗
                          </a>
                        )}
                        <button type="button" className={styles.clearLink} onClick={() => setSelectedJob(null)}>
                          clear
                        </button>
                      </span>
                    </div>
                  )}
                  {!suggestMode && (
                    <p className={styles.srOnly} role="status">
                      {jobsLoading
                        ? 'Searching roles…'
                        : jobResults.length > 0
                          ? `${jobResults.length} role${jobResults.length === 1 ? '' : 's'} found`
                          : (jobsNote ?? 'No roles found.')}
                    </p>
                  )}
                  {!suggestMode && (
                  <ul id="job-results" className={styles.jobList} aria-label="Job search results" aria-busy={jobsLoading}>
                    {jobsLoading && <li className={styles.jobMeta}>Loading…</li>}
                    {!jobsLoading && jobResults.length === 0 && (
                      <li className={styles.jobMeta}>{jobsNote ?? 'No roles found.'}</li>
                    )}
                    {jobResults.map((job) => (
                      <li key={job.id} className={styles.jobRow}>
                        <button
                          type="button"
                          className={selectedJob?.id === job.id ? styles.jobItemOn : styles.jobItem}
                          onClick={() => setSelectedJob(job)}
                          aria-pressed={selectedJob?.id === job.id}
                        >
                          <span className={styles.jobTitle}>{job.title}</span>
                          <span className={styles.jobSub}>
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                          </span>
                        </button>
                        {job.url && (
                          <a
                            className={styles.sourceLink}
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View original posting ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <details className={styles.prefs}>
            <summary className={styles.prefsSummary}>
              Preferences <span className={styles.prefsHint}>— tune the fit score (optional)</span>
            </summary>
            <div className={styles.prefsGrid}>
              <label className={styles.prefField}>
                <span className={styles.prefLabel}>Target comp (top of band, USD)</span>
                <input
                  className={styles.prefInput}
                  inputMode="numeric"
                  value={targetComp}
                  onChange={(e) => setTargetComp(e.target.value)}
                  placeholder="e.g. 170000"
                />
              </label>
              <label className={styles.prefField}>
                <span className={styles.prefLabel}>Target roles / lanes (comma-separated)</span>
                <input
                  className={styles.prefInput}
                  value={targetLanes}
                  onChange={(e) => setTargetLanes(e.target.value)}
                  placeholder="e.g. Cloud Engineer, VMware Engineer"
                />
              </label>
              <label className={styles.prefField}>
                <span className={styles.prefLabel}>Preferred work mode</span>
                <select className={styles.prefInput} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
                  <option value="">No preference</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                  <option value="flexible">Flexible</option>
                </select>
              </label>
              <label className={styles.prefField}>
                <span className={styles.prefLabel}>Preferred employer type</span>
                <select
                  className={styles.prefInput}
                  value={employerPref}
                  onChange={(e) => setEmployerPref(e.target.value)}
                >
                  <option value="">No preference</option>
                  <option value="direct">Direct employer</option>
                  <option value="managed_services">Managed services</option>
                  <option value="consulting">Consulting</option>
                  <option value="vendor">Vendor</option>
                </select>
              </label>
              <label className={styles.prefField}>
                <span className={styles.prefLabel}>No-go locations (comma-separated)</span>
                <input
                  className={styles.prefInput}
                  value={noGo}
                  onChange={(e) => setNoGo(e.target.value)}
                  placeholder="e.g. California"
                />
              </label>
            </div>
          </details>

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
          <p className={styles.srOnly} role="status">
            {loading ? 'Generating your packet…' : ''}
          </p>
          {profileNote && <span className={styles.uploadNote}>{profileNote}</span>}
          {saved && !reuseActive && (
            <span className={styles.uploadNote}>
              Resume edited since save — this run will re-structure. Save again to reuse.
            </span>
          )}
        </form>

        {error && <ErrorPanel error={error} />}
        {packet && <PacketView packet={packet} sourceUrl={packetSourceUrl} />}
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


// Marketing landing (public) — the shareable front door (M4 / redesign). The packet app lives at
// /app, gated behind auth; this is what an anonymous visitor sees. Server component (no client JS)
// so it renders fast + SEO-clean. Premium-dark theme is self-contained in page.module.css (it owns
// its background + colors, so it never inherits the OS light/dark preference and can't go dark-on-dark).
import type { Metadata } from 'next'
import Link from 'next/link'
import WaitlistForm from '@/components/WaitlistForm'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'ScoutLane — One job, one click, one application packet',
  description:
    'Turn a job you want into a ready-to-send application packet: a fit assessment plus a tailored, ATS-safe resume and cover letter — built only from your real history. No fabrication, no scraping, no auto-applying.',
  openGraph: {
    title: 'ScoutLane — One job, one click, one application packet',
    description:
      'A fit assessment plus a tailored, ATS-safe resume and cover letter, generated only from your real history.',
    type: 'website',
  },
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Add your history once',
    body: 'Paste or upload your resume. ScoutLane structures it into a profile it reuses for every packet — your facts, captured once.',
  },
  {
    n: '2',
    title: 'Pick the role',
    body: 'Choose a job from the pool or paste a description. ScoutLane reads the requirements and scores how you fit.',
  },
  {
    n: '3',
    title: 'Get a packet you’d actually send',
    body: 'A fit assessment plus a tailored, ATS-safe resume and matching cover letter — downloadable, and grounded in your real experience.',
  },
]

const DIFFERENTIATORS: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: 'Trust',
    title: 'No fabrication — enforced in code',
    body: 'Every line in your tailored documents has to trace back to a fact in your profile. A guardrail checks each claim against your history and blocks anything it can’t verify. It’s the product’s whole promise — a test, not a hope.',
  },
  {
    eyebrow: 'Compatibility',
    title: 'ATS-safe by construction',
    body: 'Single-column, real text, no tables or graphics that applicant-tracking systems choke on. The documents are built to parse cleanly the first time.',
  },
  {
    eyebrow: 'Control',
    title: 'Your data stays yours',
    body: 'No scraping gated sites, no logging into your accounts, no auto-applying. ScoutLane prepares the packet; you stay in control of where it goes.',
  },
]

/** A stylized, non-interactive preview of a generated packet — pure SVG/markup, no real data. */
function PacketPreview() {
  // 87% of a 2πr=326.7 ring (r=52): dash gap ≈ 0.13 × 326.7 ≈ 42.5.
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewGlow} />
      <div className={styles.previewCard}>
        <div className={styles.previewHead}>
          <span className={styles.previewDocLabel}>Application packet</span>
          <span className={styles.previewBand}>Best fit</span>
        </div>

        <div className={styles.previewScoreRow}>
          <div className={styles.gauge}>
            <svg viewBox="0 0 120 120" className={styles.gaugeSvg}>
              <circle cx="60" cy="60" r="52" className={styles.gaugeTrack} />
              <circle
                cx="60"
                cy="60"
                r="52"
                className={styles.gaugeValue}
                strokeDasharray="326.7"
                strokeDashoffset="42.5"
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className={styles.gaugeCenter}>
              <span className={styles.gaugeNum}>87</span>
              <span className={styles.gaugeUnit}>/ 100</span>
            </div>
          </div>
          <div className={styles.coverage}>
            <span className={styles.covRow}>
              <span className={`${styles.covDot} ${styles.covPass}`}>✓</span> Azure
            </span>
            <span className={styles.covRow}>
              <span className={`${styles.covDot} ${styles.covPass}`}>✓</span> Security monitoring
            </span>
            <span className={styles.covRow}>
              <span className={`${styles.covDot} ${styles.covWarn}`}>~</span> Terraform
            </span>
          </div>
        </div>

        <div className={styles.docThumbs}>
          {['Resume.docx', 'Cover letter.docx'].map((name) => (
            <div key={name} className={styles.docThumb}>
              <div className={styles.docLines}>
                <span style={{ width: '70%' }} />
                <span style={{ width: '95%' }} />
                <span style={{ width: '85%' }} />
                <span style={{ width: '60%' }} />
              </div>
              <span className={styles.docName}>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <div className={styles.bgGlow} aria-hidden="true" />

      <header className={styles.nav}>
        <span className={styles.wordmark}>ScoutLane</span>
        <nav className={styles.navRight}>
          <Link href="/sign-in" className={styles.navLink}>
            Sign in
          </Link>
          <a href="#waitlist" className={styles.navCta}>
            Request access
          </a>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Invite-only early access</span>
          <h1 className={styles.headline}>
            One job, one click, <span className={styles.headlineAccent}>one application packet.</span>
          </h1>
          <p className={styles.subhead}>
            ScoutLane turns a job you want into a ready-to-send packet — a fit assessment plus a
            tailored, ATS-safe resume and cover letter, generated only from your real history.
          </p>
          <div className={styles.ctaRow}>
            <a href="#waitlist" className={styles.primaryCta}>
              Request access
            </a>
            <a href="#how" className={styles.secondaryCta}>
              See how it works
            </a>
          </div>
          <p className={styles.inviteNote}>
            Already invited?{' '}
            <Link href="/sign-in" className={styles.inlineLink}>
              Sign in
            </Link>
          </p>
        </div>
        <PacketPreview />
      </section>

      <section className={styles.trustStrip}>
        <span>No fabrication</span>
        <span className={styles.trustDot} aria-hidden>
          ·
        </span>
        <span>ATS-safe</span>
        <span className={styles.trustDot} aria-hidden>
          ·
        </span>
        <span>No scraping</span>
        <span className={styles.trustDot} aria-hidden>
          ·
        </span>
        <span>No auto-applying</span>
      </section>

      <section id="how" className={styles.section}>
        <span className={styles.kicker}>How it works</span>
        <h2 className={styles.sectionTitle}>From résumé to ready-to-send in three steps</h2>
        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.n} className={styles.step}>
              <span className={styles.stepNum}>{s.n}</span>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepBody}>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <span className={styles.kicker}>Why it’s different</span>
        <h2 className={styles.sectionTitle}>Built to be trusted, not just fast</h2>
        <div className={styles.cards}>
          {DIFFERENTIATORS.map((d) => (
            <div key={d.title} className={styles.card}>
              <span className={styles.cardEyebrow}>{d.eyebrow}</span>
              <h3 className={styles.cardTitle}>{d.title}</h3>
              <p className={styles.cardBody}>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="waitlist" className={styles.closing}>
        <div className={styles.closingInner}>
          <h2 className={styles.closingTitle}>Get your first packet</h2>
          <p className={styles.closingBody}>
            Leave your email and we’ll send an invite when a spot opens.
          </p>
          <WaitlistForm />
          <p className={styles.inviteNote}>
            Already invited?{' '}
            <Link href="/sign-in" className={styles.inlineLink}>
              Sign in
            </Link>
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span className={styles.footerMark}>ScoutLane</span>
        <span className={styles.footerNote}>Built only from your real history.</span>
      </footer>
    </main>
  )
}

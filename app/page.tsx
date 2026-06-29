// Marketing landing (public) — the shareable front door (M4). The packet app itself lives at /app,
// gated behind auth; this page is what an anonymous visitor sees. Kept a server component (no client
// JS) so it renders fast and SEO-clean. The waitlist capture form arrives in M4-B; today the primary
// CTA routes invited users to sign-in.
import type { Metadata } from 'next'
import Link from 'next/link'
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

const DIFFERENTIATORS: { title: string; body: string }[] = [
  {
    title: 'No fabrication — enforced in code',
    body: 'Every line in your tailored documents has to trace back to a fact in your profile. A guardrail checks each claim against your history and blocks anything it can’t verify. It’s the product’s whole promise, so it’s a test, not a hope.',
  },
  {
    title: 'ATS-safe by construction',
    body: 'Single-column, real-text, no tables or graphics that applicant-tracking systems choke on. The documents are built to parse cleanly the first time.',
  },
  {
    title: 'Your data stays yours',
    body: 'No scraping gated sites, no logging into your accounts, no auto-applying. ScoutLane prepares the packet; you stay in control of where it goes.',
  },
]

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.wordmark}>ScoutLane</span>
        <Link href="/sign-in" className={styles.navLink}>
          Sign in
        </Link>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.headline}>One job, one click, one application packet.</h1>
        <p className={styles.subhead}>
          ScoutLane turns a job you want into a ready-to-send packet: a fit assessment plus a
          tailored, ATS-safe resume and cover letter — generated only from your real history.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/sign-in" className={styles.primaryCta}>
            Sign in
          </Link>
          <a href="#how" className={styles.secondaryCta}>
            See how it works
          </a>
        </div>
        <p className={styles.inviteNote}>Access is invite-only while we’re in early access.</p>
      </section>

      <section className={styles.trustStrip}>
        <span>No fabrication</span>
        <span aria-hidden>·</span>
        <span>No scraping</span>
        <span aria-hidden>·</span>
        <span>No auto-applying</span>
      </section>

      <section id="how" className={styles.section}>
        <h2 className={styles.sectionTitle}>How it works</h2>
        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.n} className={styles.step}>
              <span className={styles.stepNum}>{s.n}</span>
              <div>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepBody}>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Why it’s different</h2>
        <div className={styles.cards}>
          {DIFFERENTIATORS.map((d) => (
            <div key={d.title} className={styles.card}>
              <h3 className={styles.cardTitle}>{d.title}</h3>
              <p className={styles.cardBody}>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.closing}>
        <h2 className={styles.closingTitle}>Ready when you are.</h2>
        <p className={styles.closingBody}>
          If you’ve been invited, sign in to generate your first packet.
        </p>
        <Link href="/sign-in" className={styles.primaryCta}>
          Sign in
        </Link>
      </section>

      <footer className={styles.footer}>
        <span>ScoutLane</span>
        <span className={styles.footerNote}>Built only from your real history.</span>
      </footer>
    </main>
  )
}

// Marketing landing: "The Signal" (M4 redesign, Cowork-approved mockup C-v2). Public front door;
// the gated packet app lives at /app. Server component (no client JS) except the waitlist form.
// Copy follows docs/VOICE_STYLE_GUIDE.md, enforced by `npm run lint:copy` (no em dashes, no repeated
// spaces, one CTA verb, vocabulary rotation), the same bar guardrails.ts holds on generated documents.
import type { Metadata } from 'next'
import Link from 'next/link'
import WaitlistForm from '@/components/WaitlistForm'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'ScoutLane: the application packet that can’t make things up',
  description:
    'Paste a job and your own history. ScoutLane builds a complete application packet (a fit score, a tailored ATS-safe resume, a cover letter, and hiring-manager outreach) that maps to what’s there. No fabrication, no invented credentials, no auto-applying.',
  openGraph: {
    title: 'ScoutLane: the application packet that can’t make things up',
    description:
      'A fit assessment plus a tailored, ATS-safe resume, cover letter, and hiring-manager outreach, built only from your own history.',
    type: 'website',
  },
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.logo}>
          <span className={styles.logoS}>Scout</span>Lane
        </div>
        <ul className={styles.navLinks}>
          <li><a href="#preview">Preview</a></li>
          <li><a href="#how">How it works</a></li>
          <li><a href="#pledge">Our pledge</a></li>
        </ul>
        <div className={styles.navRight}>
          <Link href="/sign-in" className={styles.navSignin}>Sign in</Link>
          <a href="#waitlist" className={styles.navCta}>Request access</a>
        </div>
      </nav>

      {/* HERO: Before / After */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroHead}>
            <div className={styles.eyebrowGreen}>No fabrication. Enforced in code.</div>
            <h1 className={styles.headline}>
              The application packet<br />that can’t make things up.
            </h1>
            <p className={styles.heroHeadP}>
              Paste a job. Add your real history. ScoutLane returns a complete application packet where
              every line is built from what you gave it and checked before it ships.
            </p>
            <div className={styles.ctaRow}>
              <a href="#waitlist" className={styles.btnPrimary}>Request access →</a>
              <span className={styles.ctaNote}>Invite-only · Pre-launch · ATS-safe</span>
            </div>
          </div>

          <div className={styles.baGrid}>
            {/* BEFORE */}
            <div className={styles.cardBefore}>
              <div className={styles.cardHeadBad}>✗ &nbsp;The old way</div>
              <div className={styles.jobLine}>Software Engineer application · Acme Inc</div>
              <div className={styles.beforeBullets}>
                <div className={styles.beforeBullet}>Experienced engineer with strong technical skills</div>
                <div className={styles.beforeBullet}>Built various web applications and APIs using modern technologies</div>
                <div className={styles.beforeBullet}>Improved system performance and collaborated across teams</div>
                <div className={styles.beforeBullet}>Passionate about scalable, maintainable code</div>
              </div>
              <div className={styles.badFlags}>
                <div className={styles.badFlag}><span className={styles.fx}>✗</span>No fit score, so confidence is a guess</div>
                <div className={styles.badFlag}><span className={styles.fx}>✗</span>Vague bullets, not matched to the role</div>
                <div className={styles.badFlag}><span className={styles.fx}>✗</span>Keywords may or may not match what the ATS expects</div>
                <div className={styles.badFlag}><span className={styles.fx}>✗</span>“Passionate about” language no recruiter believes</div>
              </div>
              <div className={styles.cardFoot}>Generic and untailored · Could be sent to any role at any company</div>
            </div>

            {/* ARROW */}
            <div className={styles.baArrow}>
              <div className={styles.arrowIco}>→</div>
              <div className={styles.arrowLabel}>ScoutLane</div>
            </div>

            {/* AFTER */}
            <div className={styles.cardAfter}>
              <div className={styles.cardHeadGood}>✓ &nbsp;ScoutLane packet</div>
              <div className={styles.afterScoreRow}>
                <span className={styles.scorePill}>89 / 100</span>
                <span className={styles.scoreLabel}>Best fit · 6 of 7 requirements met</span>
              </div>
              <div className={styles.afterBullets}>
                <div className={styles.afterBullet}>
                  <span className={styles.abk}>✓</span>
                  <div>Cut p95 API latency 40% by migrating to an async message queue. <span className={styles.why}>Meets JD: “high-throughput, low-latency systems”</span></div>
                </div>
                <div className={styles.afterBullet}>
                  <span className={styles.abk}>✓</span>
                  <div>Led a 3-engineer auth migration, delivered 2 weeks ahead of schedule. <span className={styles.why}>Meets JD: “cross-functional collaboration”</span></div>
                </div>
                <div className={styles.afterBullet}>
                  <span className={styles.abk}>✓</span>
                  <div>Held 99.97% uptime across 4 service deployments in FY24. <span className={styles.why}>Meets JD: “production reliability ownership”</span></div>
                </div>
              </div>
              <div className={styles.goodFlags}>
                <div className={styles.goodFlag}><span className={styles.gx}>✓</span>ATS scan: 0 flags · 0 invisible text · 0 stuffing</div>
                <div className={styles.goodFlag}><span className={styles.gx}>✓</span>Cover letter speaks to Acme’s Series B stage and engineering mandate</div>
                <div className={styles.goodFlag}><span className={styles.gx}>✓</span>Hiring-manager outreach ready to personalize, never mass-sent</div>
                <div className={styles.goodFlag}><span className={styles.gx}>✓</span>Every bullet traceable to your provided history</div>
              </div>
              <div className={styles.afterNote}>
                <em>Nothing invented.</em> If you haven’t done it, it isn’t in your packet.
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* PRODUCT PREVIEW */}
      <section className={styles.previewSection} id="preview">
        <div className={styles.previewInner}>
          <div className={styles.previewHead}>
            <div className={styles.eyebrow}>The finished output</div>
            <h2 className={styles.h2}>Here’s what you get<br />when it’s done.</h2>
            <p>One candidate, one specific role, scored across eight dimensions. Every claim is checked against the history they provided, and the gaps are shown too.</p>
          </div>

          <div className={styles.appFrame}>
            <div className={styles.appHdr}>
              <div>
                <div className={styles.appHdrMark}>ScoutLane · Application Packet</div>
                <div className={styles.appHdrRole}>Senior Software Engineer · Novalus Health</div>
              </div>
              <div className={styles.appHdrMeta}>Generated Jun 29, 2026 · From your provided history</div>
            </div>

            <div className={styles.appBody}>
              <div className={styles.fitRow}>
                <div className={styles.ringArea}>
                  <svg width="120" height="120" viewBox="0 0 120 120" aria-label="Fit score: 89 out of 100">
                    <circle cx="60" cy="60" r="46" stroke="#E5E7EB" strokeWidth="9" fill="none" />
                    <circle cx="60" cy="60" r="46" stroke="#065F46" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray="257 32" transform="rotate(-90 60 60)" />
                    <text x="60" y="53" textAnchor="middle" style={{ fontFamily: 'var(--font-body)' }} fontSize="26" fontWeight="800" fill="#111827">89</text>
                    <text x="60" y="70" textAnchor="middle" style={{ fontFamily: 'var(--font-body)' }} fontSize="11" fill="#4B5563">/100</text>
                  </svg>
                  <div className={styles.ringVerdict}>Best fit</div>
                  <div className={styles.ringSub}>Weighted 86.8 base<br />+ adjustment 2.2</div>
                </div>

                <div className={styles.dimsCol}>
                  <div className={styles.dimsHead}>Fit by dimension</div>
                  <div className={styles.dimsList}>
                    {[
                      ['Role-type match', 95, false],
                      ['Core skills coverage', 90, false],
                      ['Seniority / scope match', 82, false],
                      ['Domain / vertical fit', 63, true],
                      ['Certifications & ATS', 88, false],
                    ].map(([label, val, amber]) => (
                      <div className={styles.dimItem} key={label as string}>
                        <div className={styles.dimLabel}>{label}</div>
                        <div className={styles.dimBg}>
                          <div className={`${styles.dimFill} ${amber ? styles.dimAmber : styles.dimGreen}`} style={{ width: `${val}%` }} />
                        </div>
                        <div className={`${styles.dimNum} ${amber ? styles.dimNumAmber : ''}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.wwRow}>
                <div className={`${styles.wwCol} ${styles.wwWhy}`}>
                  <div className={styles.wwColHead}>✓ Why you fit</div>
                  <div className={styles.wwItem}><span className={styles.wwItemIco}>·</span><span>Deep async systems background. <em>Matches: “reliable low-latency infrastructure”</em></span></div>
                  <div className={styles.wwItem}><span className={styles.wwItemIco}>·</span><span>Led a 3-engineer sub-team through a production migration. <em>Matches: “engineering ownership, cross-functional”</em></span></div>
                </div>
                <div className={`${styles.wwCol} ${styles.wwWarn}`}>
                  <div className={styles.wwColHead}>⚠ Watch-outs</div>
                  <div className={`${styles.wwItem} ${styles.wText}`}><span className={styles.wwItemIco}>·</span><span>No fintech or healthcare domain experience in your provided history. Flagged in your packet, not hidden.</span></div>
                </div>
              </div>

              <div className={styles.honestBox}>
                <strong>The unfiltered part:</strong> this packet only surfaces what’s genuinely in your history. The no-fabrication guardrail ran and passed: zero invented bullets, zero inferred credentials, zero keyword stuffing. The domain gap above is real, and it’s in your packet too.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GUARDRAIL STRIP */}
      <div className={styles.guardrailStrip}>
        <div className={styles.gsInner}>
          <div className={styles.gsLabel}>Every packet clears these checks before delivery</div>
          <div className={styles.badgeRow}>
            {['No fabrication', 'Banned terms', 'Style', 'ATS-safe', 'Cert currency'].map((b) => (
              <div className={styles.grBadge} key={b}>✓ &nbsp;{b}</div>
            ))}
          </div>
        </div>
      </div>

      {/* WHAT YOU GET */}
      <section className={styles.getSection}>
        <div className={styles.getInner}>
          <div className={styles.getHead}>
            <div className={styles.eyebrow}>The packet</div>
            <h2 className={styles.h2}>Four deliverables.<br />One source.</h2>
            <p>A complete application packet: a fit score, a tailored resume, a cover letter, and hiring-manager outreach, every piece connected back to what you gave us.</p>
          </div>

          <div className={styles.getCards}>
            {/* Card 1: Fit Report */}
            <div className={styles.getCard}>
              <div className={styles.getChip}>Fit Report</div>
              <h3 className={styles.getCardTitle}>Your verified match, scored.</h3>
              <p className={styles.getCardP}>Eight dimensions, one verdict. Every requirement is flagged met, partial, or missing, so you apply with confidence or skip with clarity.</p>
              <div className={styles.miniRingArea}>
                <svg width="60" height="60" viewBox="0 0 60 60" aria-label="Fit score 89">
                  <circle cx="30" cy="30" r="23" stroke="#E5E7EB" strokeWidth="5" fill="none" />
                  <circle cx="30" cy="30" r="23" stroke="#065F46" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray="129 16" transform="rotate(-90 30 30)" />
                  <text x="30" y="26" textAnchor="middle" style={{ fontFamily: 'var(--font-body)' }} fontSize="13" fontWeight="800" fill="#111827">89</text>
                  <text x="30" y="37" textAnchor="middle" style={{ fontFamily: 'var(--font-body)' }} fontSize="7" fill="#4B5563">/100</text>
                </svg>
                <div>
                  <div className={styles.mrtVerdict}>Best fit</div>
                  <div className={styles.mrtSub}>1 gap flagged<br />5 dims scored</div>
                </div>
              </div>
              <div className={styles.miniDims}>
                {[['Role-type match', 95, false], ['Core skills', 90, false], ['Domain fit', 63, true]].map(([l, v, a]) => (
                  <div className={styles.miniDim} key={l as string}>
                    <div className={styles.miniDimLbl}>{l}</div>
                    <div className={styles.miniDimBg}><div className={`${styles.miniDimFill} ${a ? styles.dimAmber : styles.dimGreen}`} style={{ width: `${v}%` }} /></div>
                    <div className={`${styles.miniDimScore} ${a ? styles.dimNumAmber : ''}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div className={styles.getCardFoot}>8 dimensions scored · Weighted total · Gaps shown, not hidden</div>
            </div>

            {/* Card 2: Tailored Resume */}
            <div className={styles.getCard}>
              <div className={styles.getChip}>Tailored Resume</div>
              <h3 className={styles.getCardTitle}>Your history, matched to the role.</h3>
              <p className={styles.getCardP}>Bullets rewritten to match the role’s language and requirements, with every edit sourced to something you told us.</p>
              <div className={styles.miniBullets}>
                <div className={styles.miniB}><span className={styles.mk}>✓</span><div>Cut p95 API latency 40% by migrating to an async message queue<span className={styles.mw}>meets JD: “high-throughput, low-latency systems”</span></div></div>
                <div className={styles.miniB}><span className={styles.mk}>✓</span><div>Led a 3-engineer auth migration, delivered 2 weeks ahead of schedule<span className={styles.mw}>meets JD: “cross-functional collaboration”</span></div></div>
                <div className={styles.miniB}><span className={styles.mk}>✓</span><div>Held 99.97% uptime across 4 service deployments in FY24<span className={styles.mw}>meets JD: “production reliability ownership”</span></div></div>
              </div>
              <div className={styles.getCardFoot}>4 bullets adjusted · 0 invented · Every source citable in an interview</div>
            </div>

            {/* Card 3: Cover Letter */}
            <div className={styles.getCard}>
              <div className={styles.getChip}>Cover Letter</div>
              <h3 className={styles.getCardTitle}>One letter, written for one role.</h3>
              <p className={styles.getCardP}>Stage-aware and role-specific, written from your own talking points instead of a generic opener that could go anywhere.</p>
              <div className={styles.clPreview}>
                “Novalus’s focus on rebuilding core infrastructure at Series B is exactly the high-ownership environment where I’ve delivered most. Most recently, I cut p95 API latency 40% through a migration I scoped and led end to end…”
              </div>
              <div className={styles.clChips}>
                {['311 words', 'ATS-clean', 'Stage-aware', 'No “passionate about”'].map((c) => (
                  <span className={styles.clChip} key={c}>{c}</span>
                ))}
              </div>
              <div className={styles.getCardFoot}>Tied to this role’s specifics · References your own talking points</div>
            </div>

            {/* Card 4: Hiring Manager Outreach */}
            <div className={styles.getCard}>
              <div className={styles.getChip}>Hiring Manager Outreach</div>
              <h3 className={styles.getCardTitle}>One note, built from the same facts.</h3>
              <p className={styles.getCardP}>A LinkedIn connection note and a follow-up email, pulled from the same facts as your packet, meant to be personalized, never mass-sent.</p>
              <div className={styles.clPreview}>
                “Hi Novalus team, your core-infrastructure rebuild at Series B is exactly the kind of work I love. I saw the Senior Software Engineer role and wanted to reach out. I recently led an async migration that made our slowest API calls about 40% faster. Would love to connect.”
              </div>
              <div className={styles.clChips}>
                {['269/300 chars', '2 openers', 'LinkedIn + email'].map((c) => (
                  <span className={styles.clChip} key={c}>{c}</span>
                ))}
              </div>
              <div className={styles.getCardFoot}>2 ready-to-send openers · 0 invented · Personalize before sending</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={styles.howSection} id="how">
        <div className={styles.sectionInner}>
          <div className={styles.eyebrow}>Process</div>
          <h2 className={styles.h2}>From three inputs<br />to one packet.</h2>
          <p className={styles.sectP}>No inventing. No enriching your profile from outside sources. ScoutLane works only with what you give it, and produces only what you can defend in an interview.</p>
          <div className={styles.stepsV}>
            {[
              ['1', 'Add a job listing', 'Paste the full text, or pick a role from the built-in job pool. ScoutLane reads what the role requires: not just surface keywords, but the seniority signals, stack expectations, and team context the description reveals between the lines.'],
              ['2', 'Connect your own history', 'Upload a resume, paste your LinkedIn profile, or describe your experience in plain language. ScoutLane works only from what you provide. Zero enrichment from your personal profiles. Nothing you didn’t give us yourself.'],
              ['3', 'Download your application packet', 'A fit score showing the requirements you meet and the ones you don’t, a role-tailored resume with cited sources, a cover letter written for the role, and hiring-manager outreach you can personalize. Every line traces back to something you told us, and nothing else.'],
            ].map(([n, title, body]) => (
              <div className={styles.stepv} key={n}>
                <div className={styles.stepvN}>{n}</div>
                <div className={styles.stepvBody}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLEDGE */}
      <div className={styles.pledgeSection} id="pledge">
        <div className={styles.pledgeInner}>
          <h2 className={styles.pledgeHead}>We set hard limits.<br />Then we built around them.</h2>
          <p className={styles.pledgeSub}>Most AI resume tools optimize for looking good. ScoutLane optimizes for being accountable. These aren’t settings you can toggle off.</p>
          <div className={styles.pledgeGrid}>
            <div className={styles.pledgeCol}>
              <div className={styles.pledgeColHead}>What we will never do</div>
              {[
                'Invent experience, metrics, or skills you don’t have',
                'Stuff keywords into invisible white text',
                'Scrape your data from LinkedIn, GitHub, or anywhere else',
                'Auto-apply to jobs without your explicit review',
                'Produce output you couldn’t defend in a real interview',
              ].map((t) => (
                <div className={`${styles.pledgeRow} ${styles.bad}`} key={t}><span className={styles.pio}>✗</span>{t}</div>
              ))}
            </div>
            <div className={styles.pledgeCol}>
              <div className={styles.pledgeColHead}>What we always do</div>
              {[
                'Build your packet only from the history you provide',
                'Show exactly which requirements you meet and which you don’t',
                'Produce clean ATS formatting, with no tricks and no hacks',
                'Give you one deliberate application, not a blast of generic ones',
                'Make every output traceable back to your provided source material',
              ].map((t) => (
                <div className={styles.pledgeRow} key={t}><span className={styles.pio}>✓</span>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* WAITLIST */}
      <div className={styles.waitlist} id="waitlist">
        <div className={styles.waitlistInner}>
          <div className={styles.eyebrow}>Early access</div>
          <h2 className={styles.h2}>Join the waitlist.</h2>
          <p className={styles.waitlistP}>
            ScoutLane is invite-only during pre-launch. Leave your email and we’ll reach out when your
            spot opens. Already invited?{' '}
            <Link href="/sign-in" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in</Link>.
          </p>
          <WaitlistForm />
        </div>
      </div>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerLogo}><span className={styles.logoS}>Scout</span>Lane</div>
        <p className={styles.footerMeta}>© 2026 ScoutLane · Invite-only pre-launch · Built for honest job-seekers</p>
      </footer>
    </main>
  )
}

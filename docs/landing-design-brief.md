# ScoutLane — Landing Page Design Brief (Cowork handoff)

> **Purpose.** A self-contained brief for experimenting with landing-page mockups in Cowork. Paste
> this into a Cowork task (or open it there), explore directions freely, then hand the chosen
> direction back to engineering for implementation. Nothing here is binding except the **Hard
> constraints** — treat everything else as a starting point to push on.
>
> **Current code baseline:** branch `claude/landing-redesign` (PR #64). Live preview on the Vercel
> branch deployment. The implemented design is the "premium dark + indigo" direction described below.

---

## 1. The product in one line
ScoutLane turns a job you want into a **ready-to-send application packet**: a fit assessment plus a
tailored, **ATS-safe** resume and cover letter — generated **only from your real history**.

**What a "packet" is:** (1) a fit score + reasoning, (2) a tailored `.docx` resume, (3) a matching
`.docx` cover letter. One click, grounded in facts the user actually provided.

## 2. Who it's for & the emotional job
Professionals actively job-hunting who are **skeptical of AI resume tools** ("won't it just make
stuff up / get me screened out?"). The landing must earn **trust fast** and make them feel the tool
is honest and on their side — not a spammy auto-applier.

## 3. Positioning (how we win)
Rivals lead with features: **Teal** = application tracking, **Rezi** = ATS/keyword optimization,
**Kickresume** = a feature-overloaded "career hub," **Enhancv** = polished editor. None of them lead
with **honesty as a feature**. ScoutLane's wedge:
- **No fabrication — enforced in code.** Every claim in the docs must trace to a real profile fact;
  a guardrail blocks anything it can't verify. (This is literally true in the product, not marketing.)
- **ATS-safe by construction** (single-column, real text, no tables/graphics that parsers choke on).
- **One-click packet** (fit + resume + cover together), not just a resume editor.
- **Your data stays yours** — no scraping gated sites, no logging into accounts, no auto-applying.

Lead the hero + first value card with the trust angle.

## 4. Hard constraints (do not violate)
- **Legally distinct from AWS.** Do **not** mimic AWS branding: avoid the "Squid Ink `#232F3E` +
  orange `#FF9900`" combination, the smile/arrow motif, or anything that reads as AWS. (This is why
  the current accent moved from copper/orange to **indigo/violet**.) Also don't copy any rival's logo
  or exact brand palette.
- **Accessibility:** WCAG **AA** contrast minimum; honor `prefers-reduced-motion`; keyboard-navigable.
- **Responsive:** mobile-first; the hero must stack cleanly on phones.
- **Honest copy:** keep the "no fabrication / no scraping / no auto-applying" promises accurate —
  they're product invariants, not puffery. Don't invent testimonials, fake logos, or metrics we
  don't have (the product is pre-launch, invite-only).
- **Invite-only early access:** primary CTA is "Request access" → a waitlist; secondary path is
  "Sign in" for already-invited users. No public self-serve signup yet.
- **Implementation-friendly (for when it returns to code):** the landing is a **Next.js 16 server
  component** styled with a **CSS Module**; prefer **no new dependencies** and **no heavy images/JS**.
  The theme must be **self-contained** (own its background + tokens) so it never inherits the OS
  light/dark preference — the original bug was dark text on an OS-dark background.

## 5. Current design baseline ("premium dark + indigo")
- **Mood:** sleek, premium, trustworthy, modern-SaaS (think Linear/Vercel-dark, not flashy).
- **Palette (tokens):**
  - Base `#0E1116` (deep slate, not pure black) · elevated surface `#161B22`
  - Text `#EEF1F6` (headings) · `#B3BCCB` (body) · `#828D9D` (captions)
  - Brand navy `#3D5E8C` (glows/preview) · **accent indigo `#AAB2FF`** (text/UI) ·
    deeper indigo `#6D5EF0` (edges) · **CTA gradient `#7C6EF2 → #5B4CE6`** (white text)
  - Status green `#6EE7A8` (the "Best fit" pill / coverage checks)
- **Layout (top→bottom):** sticky slim nav → **split hero** (copy + dual CTA left; a stylized
  CSS/SVG "packet preview" right: fit gauge `87/100`, skill coverage, resume/cover thumbnails) →
  trust strip → "How it works" (3 step cards) → "Why it's different" (3 value cards) → closing
  waitlist card → footer.
- **Motion:** subtle rise-in on hero, hover-lift on cards. Ambient navy→indigo glow behind the hero.

## 6. Content inventory (reusable copy)
- **Eyebrow:** "Invite-only early access"
- **Headline:** "One job, one click, one application packet." (accent the last phrase)
- **Subhead:** "ScoutLane turns a job you want into a ready-to-send packet — a fit assessment plus a
  tailored, ATS-safe resume and cover letter, generated only from your real history."
- **CTAs:** primary "Request access" (→ waitlist) · secondary "See how it works"
- **Trust strip:** No fabrication · ATS-safe · No scraping · No auto-applying
- **How it works:** 1) Add your history once 2) Pick the role 3) Get a packet you'd actually send
- **Why it's different:** Trust → "No fabrication — enforced in code" · Compatibility → "ATS-safe by
  construction" · Control → "Your data stays yours"
- **Closing:** "Get your first packet" + email capture ("we'll send an invite when a spot opens")

## 7. What to explore in Cowork
Push on these — bring back 2–3 distinct directions:
- **Aesthetic forks:** the current premium-dark/indigo vs. a **light & clean** (trust-forward,
  Stripe/Enhancv-like) vs. **light with a bold accent band**. (We chose dark, but it's worth seeing
  alternatives side by side.)
- **Hero treatments:** the split product-preview vs. a centered typographic hero vs. an
  animated/annotated packet mock vs. a before→after ("your resume" → "tailored packet").
- **Trust proof:** how to convey "no fabrication" visually (e.g. a "claim → source" diagram, a
  blocked-hallucination badge) without fake social proof.
- **Type & spacing:** heading/body pairings, density, rhythm.
- **Accent options** (all must stay clear of AWS orange): indigo/violet (current), teal/emerald,
  or a refined warm tone that isn't AWS yellow-orange.

## 8. Deliverable formats Cowork can produce
- Static **HTML/CSS mockups** (easiest to translate to the CSS Module) or rendered **images** of each
  direction.
- If using the **Figma** plugin, a frame per direction (desktop + mobile) is ideal for review.
- For each direction, include **desktop + mobile** and call out the palette tokens used.

## 9. Handing the winner back to code
Map the chosen direction onto:
- `app/page.tsx` — the landing markup (server component; sections as above).
- `app/page.module.css` — the self-contained theme + layout (CSS variables at `.page` root).
- `components/WaitlistForm.tsx` — the email-capture form (client component) styled to the theme.
- Keep it dependency-free, AA-contrast, responsive, and self-theming. Acceptance: readable, on-brand,
  conversion-oriented, and unmistakably **not** AWS.

_That's the brief. Explore freely; the Hard constraints (§4) are the only guardrails._

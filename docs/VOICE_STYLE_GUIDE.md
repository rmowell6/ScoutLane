# ScoutLane Voice & Style Guide

**Purpose:** codify the rules for all user-facing copy — marketing pages, in-app strings, emails — so style stays consistent without a manual re-review each time. Companion to `CLAUDE.md` (engineering rules) and `docs/Fit_Assessment_SPEC.md` (scoring). `lib/guardrails.ts` already enforces mechanical style checks on LLM-generated résumés/cover letters (`checkStyle()`); this guide extends the same standard to everything else, and section 7 makes it enforceable the same way.

---

## 1. Voice pillars

Four adjectives, in priority order:

1. **Evidence-first.** Every claim is backed by a number, a named check, or a concrete example, not an adjective. ("Zero invented bullets" beats "totally honest.")
2. **Plainspoken.** Short sentences, real words, no jargon inflation ("leverage," "synergy," "unlock"). If a reader wouldn't say it out loud, cut it.
3. **Contrarian-honest.** The brand differentiates by refusing tricks other tools use (keyword stuffing, invisible text, auto-apply). Say what we refuse to do once per surface, not once per section.
4. **Confident, not hyped.** State facts plainly. Intensifiers ("actually," "really," "truly") should never stand in for a real detail.

## 2. Hard rules (mechanical, checkable, non-negotiable)

Mirrors `checkStyle()` in `lib/guardrails.ts`:

- **No em dashes (—).** Use a period, comma, colon, or parentheses instead.
- **No repeated spaces.**
- **One CTA verb per flow.** Pick a single primary action label (e.g. "Request access") and use it everywhere that action appears on a page. Don't introduce a synonym ("Get early access," "Join now") for the same click.
- **Reused facts must match verbatim.** If the same example, number, or bullet appears in more than one section, the wording must be character-identical. Never re-paraphrase a "real" example on the way through a second section.

## 3. Vocabulary rotation (avoid word fatigue)

The brand's core promise (nothing invented, everything traceable) tends to pull copy toward the same handful of words. Rotate:

| Overused word | Rotate in |
|---|---|
| honest / honestly | verified, grounded, evidence-backed, accountable, unfiltered |
| real | actual (sparingly), genuine, your own, source-backed |
| actually / actual | mostly cut — see below |
| traceable / traced back | sourced, citable, backed by, grounded in |
| invented / inventing | fabricated, made up, pulled from nowhere |

**Rule of thumb:** no single word from the "trust" vocabulary cluster should appear more than 2-3 times on one page. If a 4th instance is needed, pull from the rotation column instead.

**"Actually" / "actual":** almost always filler. Read the sentence without it; if the meaning doesn't change, cut it.

## 4. Structural variety

Don't reuse the same sentence-level device more than twice on one page:

- **The "[Number]. [One word].” fragment** (e.g. "Three deliverables. One honest source.") — fine once, maybe twice; a third instance reads as a tic.
- **Negative framing** ("Not a resume rewriter. Not a cover letter spinner.", "No scraping. No third-party lookups.") — the brand's sharpest rhetorical weapon. Spend it once, in the section that earns it most (the pledge/guardrails section), and let earlier sections lead with the positive claim instead.

## 5. Headline scope check

Before shipping any headline, confirm it matches the scope of what the page actually sells. If the product is a three-part packet (fit score + résumé + cover letter), don't headline it as a single-purpose "resume tool" — name the outcome or the packet, not just one artifact inside it.

## 6. Worked example

**Before:** "ScoutLane builds a complete application packet that maps honestly to what's actually there — no invented bullets, no stuffed keywords, no spray-and-pray."

**After:** "ScoutLane builds a complete application packet that maps to what's actually there: no invented bullets, no stuffed keywords, no spray-and-pray."

Why: drops the redundant "honestly" (§3), swaps the em dash for a colon (§2), keeps the specific, evidence-first list.

## 7. Enforcement

- This guide lives at `docs/VOICE_STYLE_GUIDE.md` and is referenced from `CLAUDE.md` so it auto-loads every Claude Code session, the same way the engineering plan does.
- `scripts/check-copy-style.ts` scans marketing/app copy source files for em dashes and repeated spaces and fails the build if found, the same "must be green" bar the repo already holds for typecheck/lint/tests. Wired into `npm run lint:copy` and CI.
- New copy should be self-checked against sections 1-5 before merge, same as a PR gets self-reviewed against `CLAUDE.md`.

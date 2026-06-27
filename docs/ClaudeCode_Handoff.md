# ScoutLane → Claude Code Handoff Guide

**Prepared for:** Ryan · **Date:** June 26, 2026

This is how to hand the ScoutLane build to Claude Code (the CLI) so it builds well: when to migrate, how to set up, the optimized prompts to paste, and the working habits that keep it on the rails.

---

## 1. When to migrate: now

You've finished the phase this chat environment is good at — research, the validated packet prototypes, and two verified spec docs. The next phase is **writing and running real code in a real repo**: `npm install`, a dev server, tests, git commits, deploying to Vercel. That is exactly what Claude Code is for and what a sandboxed chat is not.

**The threshold, stated simply:** migrate the moment the work shifts from *deciding what to build* to *building it in a repo you can run*. You're there. Keep this environment for spec/research updates; do the build in Claude Code.

---

## 2. One-time setup (5 minutes)

1. Create the repo folder and a `docs/` subfolder.
2. Copy in: `CLAUDE.md` → repo root; `ScoutLane_POC_Build_Plan.md` and `ScoutLane_Engineering_Plan.md` → `docs/`.
3. Install Claude Code and run it in the repo folder.
4. (Optional) Run `/init` — but you already have a hand-tuned `CLAUDE.md`, so you can skip it or let it merge.
5. Create `.env.local` with the keys from the engineering plan (`ANTHROPIC_API_KEY`, the Supabase vars, `CRON_SECRET`). Never commit it.

The single biggest lever: **`CLAUDE.md` is auto-loaded every session**, so durable context lives there and your prompts stay short and task-focused. That's why the prompts below are small — the context is already loaded.

---

## 3. The core habit: one milestone per session, in plan mode

The most common mistake is handing a coding agent one giant "build the whole app" prompt. Don't. Instead, for **each milestone**:

1. **Plan first.** Press `Shift+Tab` to enter **plan mode** (read-only). Claude proposes the plan; you review and approve before any file is written.
2. **Build.** Approve, let it code.
3. **Verify.** It runs typecheck + lint + tests and fixes until green (you told it the definition of done).
4. **Commit**, then **`/clear`** before the next milestone so context stays clean.

Course-correct early: press `Esc` to interrupt, type a correction + Enter to redirect mid-task, and `/rewind` (or `Esc Esc`) to roll back if it goes sideways.

---

## 4. The kickoff prompt (paste this first)

```
Read CLAUDE.md, then read docs/ScoutLane_POC_Build_Plan.md and
docs/ScoutLane_Engineering_Plan.md in full. The Engineering Plan has
verified, copy-paste-correct syntax and pinned versions — follow it exactly
(Next.js 16.2, @supabase/ssr + getClaims, Anthropic messages.parse +
zodOutputFormat, docx runtime='nodejs', Zod 4, Node 24).

We are building Milestone M0 only (skeleton + deploy). Do NOT build the
packet pipeline yet.

Enter plan mode (Shift+Tab) and propose a plan for M0 before writing any code.
M0 is done when ALL of these are true:
- A Next.js 16 App-Router TypeScript app exists, strict tsconfig
  (strict + noUncheckedIndexedAccess) with the @/* path alias.
- lib/supabase/{client,server,admin}.ts and proxy.ts middleware exist,
  using getClaims() (no live Supabase project needed yet; read from .env.local).
- lib/anthropic.ts exports the client and the model constants.
- GET /api/health returns { ok: true }.
- ESLint + Vitest are configured with one passing smoke test.
- A GitHub Actions CI workflow is committed: actions/checkout@v6 +
  actions/setup-node@v6 (node 24, cache npm), running npm ci → tsc --noEmit
  → lint → vitest run.
- README documents setup and the required env vars.

Show me the plan first. After I approve, scaffold it, then run typecheck,
lint, and tests and fix until all green. Stop for my review before M1.
```

Why this works: it loads context from files (no pasting), scopes to one milestone, forces a plan before edits, and gives an explicit, checkable definition of done so Claude knows when to stop.

---

## 5. Milestone prompts (after M0 is committed)

`/clear` first, then paste the next one. Always end with "show the plan first; stop for review."

**M1 — the packet pipeline (the hero):**
```
M1 from docs/ScoutLane_POC_Build_Plan.md. Build the packet pipeline end to end:
intake a pasted resume + a pasted job description, structure them, score fit,
tailor a resume and cover letter, run the guardrails, and return the packet.

Follow the Engineering Plan exactly:
- lib/services/{structureResume,parseJob,scoreFit,tailorResume,buildPacket}.ts,
  each using anthropic.messages.parse + zodOutputFormat, reading
  message.parsed_output. Untrusted resume/JD text goes in clearly labeled,
  JSON-encoded user content, never the system prompt.
- Port my existing docx builders into lib/docgen/{resume,coverLetter}.ts;
  the /api/packet route sets runtime='nodejs'.
- lib/guardrails.ts: checkNoFabrication (every tailored claim must trace to a
  profile fact), checkBannedTerms, checkAtsSafe, checkStyle. Write Vitest unit
  tests for guardrails FIRST (TDD), including a case that rejects a fabricated
  skill, then make them pass.
- /api/packet validates input with Zod, calls buildPacket, returns the packet.

Plan first. Then build, run typecheck + lint + tests until green, and stop.
```

(My existing docx builders to port: `Ryan_Resume_Build_*.js` and the cover-letter builders — bring them into the repo so Claude can adapt them.)

**Later milestones** follow the same shape: name the milestone, point at the plan, list the concrete deliverables, demand TDD on anything safety-critical, end with "plan first, verify green, stop."

---

## 6. Make repetitive work one keystroke (custom commands)

Create `.claude/commands/verify.md`:
```
Run npm run typecheck, npm run lint, and npm run test:run.
Fix any failures, then re-run until all three pass. Show the final output.
```
Then just type `/verify` before every commit. A `/guardrail-test` command (run only the guardrail suite and fix failures) is worth adding too, since that's your highest-stakes code.

---

## 7. Optional power-ups (add when useful)

- **MCP servers**: a Supabase MCP (`claude mcp add ... --scope project`, stored in `.mcp.json`) lets Claude query/debug your DB directly; a Playwright MCP helps with E2E. Document any auth in `CLAUDE.md`. Add these once the app boots, not on day one.
- **Headless mode** (`claude -p "..."`) for CI later — e.g., auto-fixing lint in a pipeline.

---

## 8. Permissions

Run interactive (the default) and approve tools as it goes — fine for solo dev. Only use `--dangerously-skip-permissions` inside an isolated container/VM, never on your main machine. It's blocked under `sudo`/root anyway.

---

## 9. The five habits that matter most

1. Durable context in `CLAUDE.md`; short, task-scoped prompts.
2. One milestone per session; `/clear` and commit between them.
3. Plan mode before any non-trivial change.
4. Every prompt ends with a checkable definition of done + "verify green, then stop."
5. TDD the guardrails — the no-fabrication check is the product; prove it with tests, don't trust it by eye.

---

*Sources: official Claude Code docs (best-practices, memory/CLAUDE.md, interactive mode/plan mode, slash commands, MCP, context-window, permissions, headless, checkpointing), verified June 2026.*

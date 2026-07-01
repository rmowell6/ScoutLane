# Guardrail block analytics (`packet_blocked`)

When the no-fabrication guardrail holds a packet back (`guardrails.ok === false`), the packet route
emits a server-side PostHog event, `packet_blocked`, alongside the existing server log. The goal is to
answer one question with data instead of guesswork:

> When we block a packet, are we catching a genuine **invention**, or a **true derived aggregate** the
> lexical checker can't see (e.g. "three-time VMware Certified Professional", true because the profile
> holds three VMware certs, but not a word-for-word restatement of any single fact)?

## Where it lives
- `lib/blockSignals.ts`: `deriveBlockSignals(guardrails, profile)`, a pure function that turns a failed
  guardrail report into derived signals. No claim/skill/metric **text** ever leaves the server: those
  are verbatim resume content (PII). Only counts, booleans, and low-cardinality reason strings.
- `lib/analyticsServer.ts`: `captureServer()`, an env-gated, fail-open POST to PostHog's `/capture/`
  endpoint (no `posthog-js`, no new dependency). No-op until `NEXT_PUBLIC_POSTHOG_KEY` (or `POSTHOG_KEY`)
  is set; a capture error is swallowed so it can never turn the 422 into a 500.
- `app/api/packet/route.ts`: fires the event in the existing block branch, using the Supabase user id
  (an opaque UUID, not an email) as `distinct_id`.

## Event properties
| Property | Meaning |
| --- | --- |
| `block_reasons[]` | which buckets fired: `unverifiable_claims`, `ungrounded_skills`, `ungrounded_metrics`, `bullets_metric`, `banned_terms`, `style`, `ats` |
| `unverifiable_count` | blocked tailored claims |
| `ungrounded_skill_count`, `ungrounded_metric_count`, `bullets_metric_count`, `banned_terms_count`, `style_violation_count`, `ats_problem_count` | per-check counts |
| `claims_with_number` | blocked claims carrying a digit or a spelled-out number |
| `claims_with_quantifier` | blocked claims carrying a count word ("three-time", "twice", "multiple", an ordinal) |
| **`claims_like_aggregate`** | blocked claims that carry a count **and** whose remaining content words all ground in the profile |
| **`looks_like_aggregate`** | true when at least one blocked claim looks like a true aggregate |

## How to read it
- **`looks_like_aggregate` high** across blocks → the durable fix is the **deterministic derived-fact
  index** (precompute cert counts, tenure, breadth from the structured profile so aggregates become
  groundable). Blocks are mostly true statements our checker can't see.
- **`looks_like_aggregate` low** → blocks are mostly genuine inventions; tighten the tailor prompt
  rather than expand the fact base.

`claims_like_aggregate` is a deliberately conservative heuristic (connectors dropped via guardrails'
shared `GLUE_WORDS`, alias-aware grounding), meant for bucketing analytics only. It never affects
whether a packet ships.

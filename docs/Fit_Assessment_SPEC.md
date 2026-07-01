# ScoutLane: Fit Assessment SPEC (deterministic scoring)

**Prepared for:** ScoutLane · **Date:** July 1, 2026 · **Companion to:** `lib/fit/fitScore.ts`, `lib/fit/fitScore.golden.json`, `lib/fit/fitScore.test.ts`

## Provenance and status (read first)

This document is **recovered, not reconstructed.** The body below is a faithful transcription of the original `Fit_Assessment_SPEC.md` that shipped alongside the reference engine `fit_score.js` and the parity contract `fit_score.golden.json` (the "Job Search folder" artifacts referenced in `docs/ScoutLane_POC_Build_Plan.md`). Those three files were located in this project's uploaded artifacts, read in full, and diffed against the live TypeScript port before this was written. Section references have been updated to point at the current `lib/fit/*` locations; the content is otherwise unchanged.

Two kinds of material are kept clearly separate:

- **(transcribed)** sections reproduce the original SPEC. This is recovered design, not invented.
- The **Drift audit** and **Rationale: recorded vs not recorded** sections at the end are **reconstructed from code** on July 1, 2026. They record what the diff found and, honestly, which numbers the recovered SPEC does and does not justify.

**Drift result:** none. Every weight, categorical lookup, penalty, bonus, and formula in `lib/fit/fitScore.ts` matches the reference `fit_score.js` (rubric `1.0.0`) exactly. The in-repo `lib/fit/fitScore.golden.json` is byte-identical to the reference golden file, and the golden parity test passes. `RUBRIC_VERSION` correctly remains `1.0.0`; no code change is warranted by this recovery. See the Drift audit for the two non-scoring robustness changes in the TS port that preserve golden parity.

---

## (transcribed) Why this exists

The fit score is the product's core value-add, so it must be **reproducible**: the same input must always produce the same output, on any machine, in any language. The way we guarantee that is a hard separation of concerns:

- **Extraction (fuzzy, upstream, LLM):** an LLM reads the resume + job description and emits a structured `FitInput` using structured outputs. Validated separately.
- **Scoring (exact, this engine):** pure, rule-based math over that `FitInput`. No model call, no randomness, no `Date`/locale. **Identical input -> identical output.**

The scoring is implemented as `lib/fit/fitScore.ts` and must reproduce `lib/fit/fitScore.golden.json` byte-for-byte for every case. That is the parity test.

## (transcribed) FitInput schema

Types now live in `lib/fit/fitScore.ts:34-57` (`FitInput`, plus the `RoleTypeMatch` / `SeniorityMatch` / `EmployerType` / `LocationKind` / `Vertical` unions at `:15-19`).

| Field | Type | Notes |
|---|---|---|
| roleTypeMatch | `'best'\|'solid'\|'stretch'\|'off'` | how close the title is to the candidate's target lane |
| mustHaveSkills | `string[]` | the JD's must-have skills |
| candidateSkills | `string[]` | skills the candidate genuinely has (full credit) |
| adjacentSkills | `string[]` | cert-backed / partial skills (half credit) |
| seniorityMatch | `'exact'\|'adjacent'\|'step_up'\|'mismatch'` | level/scope fit |
| compTopUsd | `number\|null` | posted top-of-band; `null` = not posted |
| targetCompTopUsd | `number` | candidate's target top-of-band |
| employerType | `'direct'\|'managed_services'\|'consulting'\|'vendor'` | reflects the direct-employer preference |
| location | `'remote_us'\|'local_metro'\|'hybrid_confirm'\|'onsite_elsewhere'` | |
| locationFlags | `{ onCall?, travelModerate?, travelHeavy? }` | logistics deductions |
| vertical | `'match'\|'adjacent'\|'none'` | domain/industry fit |
| requiredCerts / heldCerts / adjacentCerts | `string[]` | cert coverage; empty required = neutral |
| hardGaps | `string[]` | dealbreaker gaps; each penalized |
| flags | `{ expired?, unconfirmedLive?, defenseAdjacent?, heavyTravelOrPresales? }` | global penalties |
| lanesSurfaced | `number` | how many lanes surfaced this role (cross-lane conviction) |

## (transcribed) Dimensions and weights (sum = 1.00)

Weights: `lib/fit/fitScore.ts:88-97`. Labels: `:99-108`.

`roleTypeMatch 0.20`, `skillsCoverage 0.22`, `seniorityMatch 0.10`, `compAlignment 0.12`, `employerPreference 0.10`, `locationLogistics 0.10`, `verticalFit 0.08`, `certRequirementFit 0.08`.

**Categorical -> score** (lookup tables at `lib/fit/fitScore.ts:111-115`)

- roleTypeMatch: best 100, solid 80, stretch 60, off 35
- seniorityMatch: exact 95, adjacent 78, step_up 55, mismatch 40
- employerType: direct 100, managed_services 70, consulting 50, vendor 45
- location: remote_us 95, local_metro 90, hybrid_confirm 70, onsite_elsewhere 30
- vertical: match 90, adjacent 70, none 55

**Computed**

- skillsCoverage = round(100 * (full + 0.5*partial) / total); empty -> 80. (full = must-have in candidateSkills; partial = in adjacentSkills; case-insensitive). See `coverage()` at `lib/fit/fitScore.ts:138-156`.
- certRequirementFit = same coverage formula over requiredCerts/heldCerts/adjacentCerts; empty required -> 80.
- compAlignment by ratio r = compTopUsd / targetTopUsd: r>=1.10 ->100, >=1.00 ->92, >=0.97 ->85, >=0.90 ->78, >=0.80 ->62, else 45; null -> 65 (neutral). See `scoreComp()` at `lib/fit/fitScore.ts:159-179`.
- locationLogistics = location base, minus onCall 6, minus travelHeavy 8 OR travelModerate 3 (heavy wins, not additive); clamped 0-100. See `scoreLocation()` at `lib/fit/fitScore.ts:182-198`.

**Overall** (`assessFit()` at `lib/fit/fitScore.ts:201-277`)

- `base = sum(weight_i * score_i)` (`:245`)
- `penalties = min(hardGaps*5, 10) + (expired?15) + (unconfirmedLive?6) + (defenseAdjacent?10) + (heavyTravelOrPresales?4)` (`:249-257`; magnitudes at `:117`)
- `bonus = min(max(lanesSurfaced-1,0)*2, 6)` (`:260-261`; magnitudes at `:119-120`)
- `overall = clamp(round(base - penalties + bonus), 0, 100)` (`:263`)
- **Band:** >=88 Best fit, >=78 Strong fit, >=65 Stretch, else Lead. (`:264`)

## (transcribed) Worked examples (computed by the engine; locked in golden.json)

- **Jack Henry, Infrastructure Engineering Manager** -> **overall 82 (Strong fit)**; base 81.7, bonus 0, penalties 0. Dimension scores: roleType 80, skills 70, seniority 55, comp 100, employer 100, location 92, vertical 90, cert 80. (The stretch shows in seniority 55 + skills 70.)
- **Cox/RapidScale, Senior or Lead VMware Engineer** -> **overall 88 (Best fit)**; base 86.2, bonus +2 (2 lanes), penalties 0. Dimension scores: roleType 100, skills 90, seniority 95, comp 85, employer 70, location 61, vertical 70, cert 100. (Bullseye core; the only drags are employer-type 70 and logistics 61.)

These are within ~2 points of the original hand-estimated packet numbers (80 / 90); the engine now supersedes the hand estimates as the source of truth. Both cases are stored verbatim in `lib/fit/fitScore.golden.json` (case names `Jack Henry — Infrastructure Engineering Manager (stretch)` and `Cox / RapidScale — Senior or Lead VMware Engineer (bullseye)`).

## (transcribed) How parity is validated

1. Port `fit_score.js` to `lib/fit/fitScore.ts` (same constants, same formulas, ESM/TS). Done.
2. Load `lib/fit/fitScore.golden.json`; for each case assert `assessFit(case.input)` deep-equals `case.expected`. Implemented in `lib/fit/fitScore.test.ts`.
3. `lib/fit/fitScore.test.ts` (Vitest) covers golden parity, determinism, no-mutation, weight sum, and every scorer's boundaries. All must pass.
4. The LLM extraction step (FitInput from resume/JD) is validated separately with its own fixtures; it is NOT part of the scoring determinism guarantee.

## (transcribed) Changing the rubric

Weights/tables are constants at the top of `lib/fit/fitScore.ts`. On any change: bump `RUBRIC_VERSION` (`:13`), regenerate the parity contract from the reference engine, review the diff, and update dependent tests. Never edit `fitScore.golden.json` by hand.

---

## Drift audit (reconstructed from code, July 1, 2026)

Reference `fit_score.js` (rubric `1.0.0`) diffed line-by-line against live `lib/fit/fitScore.ts`. Every scoring input is identical:

| Group | Reference `fit_score.js` | Live `lib/fit/fitScore.ts` | Match |
|---|---|---|---|
| WEIGHTS | 0.20 / 0.22 / 0.10 / 0.12 / 0.10 / 0.10 / 0.08 / 0.08 | same | yes |
| ROLE_TYPE | best 100, solid 80, stretch 60, off 35 | same | yes |
| SENIORITY | exact 95, adjacent 78, step_up 55, mismatch 40 | same | yes |
| EMPLOYER | direct 100, managed_services 70, consulting 50, vendor 45 | same | yes |
| LOCATION | remote_us 95, local_metro 90, hybrid_confirm 70, onsite_elsewhere 30 | same | yes |
| VERTICAL | match 90, adjacent 70, none 55 | same | yes |
| PENALTY | hardGapEach 5, cap 10, expired 15, unconfirmedLive 6, defenseAdjacent 10, heavyTravelOrPresales 4 | same | yes |
| LOC_DEDUCT | onCall 6, travelModerate 3, travelHeavy 8 | same | yes |
| Cross-lane | per 2, cap 6 | same | yes |
| Skills/cert neutral | 80 | 80 | yes |
| Comp ratio bands + null | 100/92/85/78/62/45, null -> 65 | same | yes |
| Band thresholds | 88 / 78 / 65 | same | yes |

**Two non-scoring divergences in the TS port, both parity-safe (they do not change any golden case output, so no `RUBRIC_VERSION` bump was required):**

1. `scoreComp()` adds a guard (`lib/fit/fitScore.ts:164-166`): a non-finite or non-positive `targetTopUsd` (blank/0/upstream fallback) returns the same neutral 65 as an unposted comp, instead of computing an `Infinity`/`NaN` ratio. The reference JS has no such guard. This only affects inputs the golden file does not cover; for all valid inputs the output is identical.
2. The comp note uses a custom `withThousands()` (`:128`) instead of `toLocaleString('en-US')`. This is deliberate reproducibility hardening: `Intl`/ICU output can vary by Node build (a minimal-ICU runtime would emit `215000`), which would break golden parity. The rendered string is identical for the golden cases.

Conclusion: the rubric was ported faithfully. There is no numeric drift to reconcile and no code change is needed.

## Rationale: recorded vs not recorded

Per the recovery goal, this separates the design rationale that genuinely exists from the values that are simply asserted.

**Recorded (carried forward from the SPEC / code comments, not invented):**

- **Separation of concerns:** the LLM extracts, the engine scores; determinism is the whole point (SPEC "Why this exists"; header comment `lib/fit/fitScore.ts:1-11`).
- **Employer-type preference** "reflects the direct-employer preference" (SPEC FitInput table; comment at `lib/fit/fitScore.ts:222`).
- **Compensation neutral fallback:** an unposted comp (`null`) or an unusable target scores a neutral 65 rather than fabricating a verdict (`scoreComp` comment `lib/fit/fitScore.ts:160-166`).
- **Empty required certs -> neutral 80:** no specific certs required is not a penalty (`assessFit` comment `:234`).
- **Preferred/nice-to-have skills are display-only** and deliberately excluded from the score, so a candidate is not penalized for missing a bonus skill (`FitInput.preferredSkills` comment `:39-41`).
- **Worked-example calibration:** the two prototype packets were used to sanity-check the engine against earlier hand estimates (80/90 -> 82/88), which is the only recorded empirical check on the numbers.

**Not recorded, needs founder input.** The recovered SPEC documents *what* the values are and shows the two worked examples, but it does not record *why* the specific magnitudes were chosen. These are founder-judgment values with no written derivation:

1. Why `compAlignment` (0.12) outweighs `verticalFit` (0.08). Rationale: not recorded.
2. Why employer type is a **global** preference with a 55-point spread (direct 100 vs vendor 45) rather than a per-candidate setting. Rationale: not recorded.
3. Why `skillsCoverage` and `certRequirementFit` share the same neutral-when-empty score (80) despite very different weights (0.22 vs 0.08). Rationale: not recorded.
4. What evidence set the categorical anchors (for example `stretch 60`, `step_up 55`, the comp ratio breakpoints, and the 88/78/65 band cutoffs). Rationale: not recorded beyond the two worked examples.

Answering these is the natural next step if the rubric moves past `1.0.0`; any change must follow the "Changing the rubric" procedure above.

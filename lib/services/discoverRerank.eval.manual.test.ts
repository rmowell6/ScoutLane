// MANUAL, OPT-IN eval, it hits the LIVE Anthropic API, so it is SKIPPED unless RUN_DISCOVER_EVAL=1
// and a real ANTHROPIC_API_KEY is present. It never runs in CI (the guard keeps the normal `vitest
// run` from touching the network), same convention as tailorEffort.eval.manual.test.ts.
//
// PURPOSE: decide from EVIDENCE whether discoverRoles()'s re-rank should move from Haiku (MODELS.screen,
// no effort tier, current production) to Sonnet 5 at effort 'low' (the treatment extractFitInput and
// tailorResume already got). It runs the SAME production path (rerankRoles) at both model configs over
// LABELED shortlists and scores three things the re-rank exists to get right:
//   1. Out-of-field EXCLUSION: a decoy that only shares a buzzword (a "Cloud Sales" or "Technical
//      Recruiter, Infrastructure" role) must be scored low or omitted, never surfaced as a match.
//   2. Title-variant RECALL: real infra work under a different title (Platform / SRE / Cloud Ops)
//      must be recognized as a strong match.
//   3. PREFERENCE handling: a role in a no-go location must be treated as a near-zero dealbreaker and
//      ranked below equivalent in-bounds roles.
//
// PASS/FAIL CRITERIA (fixed BEFORE running, not tuned to the output):
//   - EXCLUSION passes iff every labeled decoy is omitted OR scored < DECOY_MAX (40).
//   - RECALL passes iff at least MIN_RECALL (4) of the 5 labeled matches score >= MATCH_MIN (60).
//   - PREFERENCE passes iff the no-go-location role scores <= NOGO_MAX (20) AND ranks strictly below
//     at least one in-bounds match.
// A model "wins" a scenario only when it passes the criterion. Latency (wall clock) and token cost
// (logModelUsage prints output + thinking tokens per call; Haiku is $1/$5 per Mtok in/out, Sonnet 5
// $3/$15, so a Sonnet call is ~3x the token cost plus any thinking tokens) are recorded for the delta.
//
// DECISION RULE: migrate to Sonnet 5 low ONLY if it MEASURABLY improves a criterion Haiku fails
// (e.g. Haiku leaks a decoy or misranks the no-go role and Sonnet fixes it) for a small cost/latency
// delta. If both pass every criterion comparably, keep Haiku (cheapest) and record that here.
//
// FINDING (recorded 2026-07-01, 3 live runs each; do not re-litigate without a NEW run):
//   - Both arms PASSED all three criteria on every run. Decoys were consistently OMITTED (zero leaks);
//     all 5 title-variant matches scored >= 60; the no-go-location role ranked last as a dealbreaker
//     (Haiku scored it a cleaner 0, Sonnet 5 low scored it 15-20, both well under the <=20 bar).
//   - Latency: Haiku faster (scenario A ~2.5-4.2s vs Sonnet ~3.7-5.0s, roughly 15% slower on Sonnet).
//   - Cost: Haiku is $1/$5 per Mtok vs Sonnet 5 $3/$15, so Sonnet is ~3x the token cost, plus thinking.
//   DECISION: KEEP HAIKU. Sonnet-5-low delivered NO measured quality gain on this re-rank (unlike the
//   real gains that justified the extractFitInput/tailorResume moves), while costing more and running
//   slower. The re-rank hands the model an already lexically pre-filtered shortlist and a tight schema,
//   so it turns out to be closer to recommendStyle's easy classification than to extractFitInput's hard
//   judgment. Revisit only if the shortlist/prompt changes materially or a new run shows a Haiku miss.
//
// Run:
//   ANTHROPIC_API_KEY=sk-ant-... RUN_DISCOVER_EVAL=1 \
//     npx vitest run lib/services/discoverRerank.eval.manual.test.ts
//   (optional EVAL_OUT=/path/to/out.json to capture the full scored results as JSON)
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { rerankRoles, type RerankCandidate, type RerankModelOptions } from './discoverRoles'
import type { CandidatePreferences, Profile } from '@/lib/schemas'

const RUN = process.env.RUN_DISCOVER_EVAL === '1'
const OUT = process.env.EVAL_OUT

// Scoring thresholds (see the criteria block above). Fixed constants so the verdict is mechanical.
const DECOY_MAX = 40
const MATCH_MIN = 60
const MIN_RECALL = 4
const NOGO_MAX = 20

// The two arms under test: current production vs the candidate treatment.
const ARMS: Array<{ label: string; opts: RerankModelOptions }> = [
  { label: 'haiku (production)', opts: {} }, // MODELS.screen, no effort tier
  { label: 'sonnet-5 low', opts: { model: 'claude-sonnet-5', effort: 'low' } },
]

// A senior infrastructure engineer (mirrors the resume in the bug report). Rich, specific skills so a
// buzzword-only decoy is clearly distinguishable from a genuine title-variant match.
const PROFILE: Profile = {
  name: 'Ryan Mowell',
  summary:
    'Senior infrastructure engineer with 10+ years running hybrid Microsoft and VMware environments ' +
    'in regulated industries. Triple VCP-certified.',
  skills: [
    'VMware vSphere',
    'Microsoft Azure',
    'Windows Server',
    'Active Directory',
    'Hyper-V',
    'PowerShell',
    'disaster recovery',
    'incident response',
    'vulnerability remediation',
  ],
  roles: [
    {
      company: 'Regional Health System',
      title: 'Senior Infrastructure Engineer',
      startDate: '2018',
      endDate: null,
      bullets: ['Architected hybrid VMware vSphere and Microsoft Azure environments'],
    },
    {
      company: 'National Bank',
      title: 'Systems Administrator',
      startDate: '2014',
      endDate: '2018',
      bullets: ['Administered Active Directory and Windows Server for 2,000 users'],
    },
  ],
  certs: [
    { name: 'VMware Certified Professional - Data Center Virtualization', status: 'active' },
    { name: 'CompTIA Security+', status: 'active' },
  ],
  education: [{ school: 'State University', degree: 'B.S.', field: 'Information Systems', year: '2013' }],
}

interface LabeledRole extends RerankCandidate {
  /** Ground truth: a genuine title-variant match vs a buzzword-only out-of-field decoy. */
  label: 'match' | 'decoy'
}

// Five real infra roles under DIFFERENT titles (recall) + five out-of-field decoys that each share
// exactly one buzzword with the candidate (exclusion). Ids are opaque; only the label is ground truth.
const SHORTLIST: LabeledRole[] = [
  { id: 'm1', label: 'match', title: 'Platform Engineer', company: 'Northwind', location: 'Austin, TX', snippet: 'Operate VMware vSphere clusters and Microsoft Azure landing zones; Windows Server, Active Directory, PowerShell automation.' },
  { id: 'm2', label: 'match', title: 'Infrastructure Engineer', company: 'Contoso', location: 'Remote (US)', snippet: 'Run hybrid Azure and on-prem VMware; disaster recovery and incident response for regulated workloads.' },
  { id: 'm3', label: 'match', title: 'Site Reliability Engineer', company: 'Fabrikam', location: 'Denver, CO', snippet: 'Reliability for Azure workloads; on-call incident response, Windows Server fleet, infrastructure as code.' },
  { id: 'm4', label: 'match', title: 'Cloud Operations Engineer', company: 'Tailspin', location: 'Remote (US)', snippet: 'Azure operations, VMware migration, patching and vulnerability remediation across Windows servers.' },
  { id: 'm5', label: 'match', title: 'Systems Engineer', company: 'Adventure Works', location: 'Columbus, OH', snippet: 'Administer Windows Server, Active Directory, Hyper-V; PowerShell scripting and DR testing.' },
  { id: 'd1', label: 'decoy', title: 'Cloud Sales Executive', company: 'Northwind', location: 'Austin, TX', snippet: 'Sell cloud solutions to enterprise accounts; own quota, build pipeline, manage CRM and forecasts.' },
  { id: 'd2', label: 'decoy', title: 'Technical Recruiter, Infrastructure Teams', company: 'Contoso', location: 'Remote (US)', snippet: 'Source and hire infrastructure and platform engineers; run the ATS pipeline and coordinate interviews.' },
  { id: 'd3', label: 'decoy', title: 'Product Marketing Manager, Cloud', company: 'Fabrikam', location: 'Remote (US)', snippet: 'Positioning and go-to-market for cloud products; messaging, launches, and campaign analytics.' },
  { id: 'd4', label: 'decoy', title: 'Customer Support Specialist', company: 'Tailspin', location: 'Remote (US)', snippet: 'Support customers using our Azure-based SaaS; work tickets, troubleshoot, and escalate.' },
  { id: 'd5', label: 'decoy', title: 'IT Financial Analyst', company: 'Adventure Works', location: 'Columbus, OH', snippet: 'Budgeting and forecasting for the IT organization; Excel modeling, vendor spend, chargeback reports.' },
]

// Preference scenario: same five matches, but one (m1, Austin) sits in a no-go location and California
// is off-limits, so we relabel m1's location to California and mark it as the dealbreaker to catch.
const PREF: CandidatePreferences = {
  targetLanes: ['Platform Engineer', 'Infrastructure Engineer'],
  noGoLocations: ['California'],
} as CandidatePreferences
const NOGO_ID = 'm1'
const PREF_SHORTLIST: RerankCandidate[] = SHORTLIST.filter((r) => r.label === 'match').map((r) =>
  r.id === NOGO_ID ? { ...r, location: 'San Francisco, California' } : r,
)

function scoreById(roles: Array<{ id: string; score: number }>): Map<string, number> {
  return new Map(roles.map((r) => [r.id, r.score]))
}

describe.skipIf(!RUN)('discover rerank model A/B (manual, live API)', () => {
  it('scores Haiku vs Sonnet-5-low on exclusion, recall, and preference handling', async () => {
    const report: unknown[] = []

    for (const arm of ARMS) {
      // Scenario A: mixed matches + decoys, no preferences (exclusion + recall).
      const tA = Date.now()
      const rankedA = await rerankRoles(PROFILE, undefined, SHORTLIST, arm.opts)
      const msA = Date.now() - tA
      const sA = scoreById(rankedA.roles)

      const decoyLeaks = SHORTLIST.filter((r) => r.label === 'decoy' && (sA.get(r.id) ?? 0) >= DECOY_MAX)
      const matchHits = SHORTLIST.filter((r) => r.label === 'match' && (sA.get(r.id) ?? 0) >= MATCH_MIN)
      const exclusionOk = decoyLeaks.length === 0
      const recallOk = matchHits.length >= MIN_RECALL

      // Scenario B: matches only, one in a no-go location (preference dealbreaker).
      const tB = Date.now()
      const rankedB = await rerankRoles(PROFILE, PREF, PREF_SHORTLIST, arm.opts)
      const msB = Date.now() - tB
      const sB = scoreById(rankedB.roles)
      const nogoScore = sB.get(NOGO_ID) ?? 0
      const otherMatchScores = PREF_SHORTLIST.filter((r) => r.id !== NOGO_ID).map((r) => sB.get(r.id) ?? 0)
      const preferenceOk = nogoScore <= NOGO_MAX && otherMatchScores.some((s) => s > nogoScore)

      const verdict = {
        arm: arm.label,
        exclusion: { pass: exclusionOk, leakedDecoys: decoyLeaks.map((d) => ({ id: d.id, title: d.title, score: sA.get(d.id) ?? null })) },
        recall: { pass: recallOk, matchesFound: matchHits.length, of: 5 },
        preference: { pass: preferenceOk, nogoScore, maxOtherMatch: Math.max(0, ...otherMatchScores) },
        latencyMs: { scenarioA: msA, scenarioB: msB },
        rawScenarioA: rankedA.roles,
        rawScenarioB: rankedB.roles,
      }
      report.push(verdict)
      console.log(
        `\n================ ${arm.label} ================\n` +
          `exclusion ${exclusionOk ? 'PASS' : 'FAIL'} (leaks: ${decoyLeaks.length}) | ` +
          `recall ${recallOk ? 'PASS' : 'FAIL'} (${matchHits.length}/5) | ` +
          `preference ${preferenceOk ? 'PASS' : 'FAIL'} (no-go=${nogoScore}) | ` +
          `latency A=${msA}ms B=${msB}ms`,
      )
      console.log(JSON.stringify(verdict, null, 2))
    }

    if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
  }, 240_000)
})

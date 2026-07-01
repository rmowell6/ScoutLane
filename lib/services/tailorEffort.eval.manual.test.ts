// MANUAL, OPT-IN eval, it hits the LIVE Anthropic API, so it is SKIPPED unless RUN_TAILOR_EVAL=1
// and a real ANTHROPIC_API_KEY is present. It never runs in CI (the guard keeps the normal `vitest
// run` from touching the network). It generates the SAME packet at `low` vs `medium` tailor effort
// through the real tailorResume() path and prints both, so we can judge faithfulness, framing, tone,
// and latency before deciding which effort the product should ship. logModelUsage() (called inside
// tailorResume) additionally prints output + thinking tokens per call.
//
// Run:
//   ANTHROPIC_API_KEY=sk-ant-... RUN_TAILOR_EVAL=1 \
//     npx vitest run lib/services/tailorEffort.eval.manual.test.ts
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { tailorResume, type TailorEffort } from './tailorResume'
import type { JobReqs, Profile } from '@/lib/schemas'

const RUN = process.env.RUN_TAILOR_EVAL === '1'
// Optional: write the full results (both packets + latency) as JSON to this path. Vitest swallows
// console.log in run mode, so a file is the reliable way to capture the outputs for review.
const OUT = process.env.EVAL_OUT

// Representative of the resume in the bug report: a senior infrastructure engineer with a regulated
// healthcare / financial-services background, applying to a public-sector security role. Rich enough
// (multiple roles, bullets, certs) that low-vs-medium framing/selection differences can show.
const PROFILE: Profile = {
  name: 'Ryan Mowell',
  summary:
    'Senior infrastructure engineer with 10+ years architecting and running hybrid Microsoft and ' +
    'VMware environments in regulated industries: federal healthcare, HIPAA-regulated healthcare, ' +
    'and financial services. Triple VCP-certified.',
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
    'HIPAA compliance',
    'NIST 800-53',
    'network security',
  ],
  roles: [
    {
      company: 'Regional Health System',
      title: 'Senior Infrastructure Engineer',
      startDate: '2018',
      endDate: null,
      bullets: [
        'Architected and operated hybrid VMware vSphere and Microsoft Azure environments across ' +
          'HIPAA-regulated healthcare workloads',
        'Led security patching and vulnerability remediation for 400+ Windows servers, cutting ' +
          'critical findings 60%',
        'Designed a disaster recovery program with a 4-hour recovery time objective across two ' +
          'data centers',
      ],
    },
    {
      company: 'National Bank',
      title: 'Systems Administrator',
      startDate: '2014',
      endDate: '2018',
      bullets: [
        'Administered Active Directory and Windows Server for 2,000 users in a financial-services ' +
          'environment',
        'Built incident response runbooks aligned to NIST 800-53 controls',
      ],
    },
  ],
  certs: [
    { name: 'VMware Certified Professional - Data Center Virtualization', status: 'active' },
    { name: 'VMware Certified Professional - Network Virtualization', status: 'active' },
    { name: 'VMware Certified Professional - Cloud Management', status: 'active' },
    { name: 'CompTIA Security+', status: 'active' },
  ],
  education: [{ school: 'State University', degree: 'B.S.', field: 'Information Systems', year: '2013' }],
}

const JOB: JobReqs = {
  title: 'Systems Administrator / IT Security Officer',
  company: 'Judicial Branch',
  mustHave: [
    'Windows Server',
    'Active Directory',
    'security patching',
    'vulnerability remediation',
    'incident response',
    'HIPAA',
    'NIST',
  ],
  niceToHave: ['VMware', 'Azure', 'disaster recovery', 'PowerShell'],
  location: 'Brooklyn, New York',
  employerType: 'government',
}

describe.skipIf(!RUN)('tailor effort A/B (manual, live API)', () => {
  it('generates the packet at low and medium for side-by-side comparison', async () => {
    const results: Array<{ effort: TailorEffort; ms: number; packet: unknown }> = []
    for (const effort of ['low', 'medium'] as TailorEffort[]) {
      const startedAt = Date.now()
      const packet = await tailorResume(PROFILE, JOB, effort)
      const ms = Date.now() - startedAt
      results.push({ effort, ms, packet })
      console.log(`\n================ EFFORT=${effort}  (${ms} ms wall clock) ================`)
      console.log(JSON.stringify(packet, null, 2))
    }
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2))
  }, 180_000)
})

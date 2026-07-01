import { describe, expect, test } from 'vitest'
import type { Profile, TailoredContent } from '@/lib/schemas'
import {
  checkAtsSafe,
  checkBannedTerms,
  checkBulletsGrounded,
  checkCertStatus,
  checkNoFabrication,
  checkStyle,
  indexFacts,
  runGuardrails,
} from '@/lib/guardrails'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'Ada Lovelace',
    summary: 'Infrastructure engineer.',
    skills: ['Azure', 'VMware'],
    roles: [
      {
        company: 'Analytical Engines',
        title: 'Platform Engineer',
        startDate: '2022',
        endDate: null,
        bullets: ['Migrated 40 VMs to Azure', 'Cut backup costs 30%'],
      },
    ],
    certs: [{ name: 'Azure Administrator Associate' }],
    education: [{ school: 'Cambridge', degree: 'BSc', field: 'Mathematics', year: '2018' }],
    ...overrides,
  }
}

function makeTailored(overrides: Partial<TailoredContent> = {}): TailoredContent {
  return {
    summary: 'Platform Engineer with Azure experience.',
    skills: ['Azure', 'VMware'],
    claims: [{ text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:0' }],
    coverLetter: 'I would be glad to bring my Azure experience to your team.',
    outreach: { linkedin: 'I bring Azure experience and would value connecting.', email: 'Hello, I bring Azure experience to your team. Best, Jordan' },
    ...overrides,
  }
}

describe('indexFacts', () => {
  test('indexes skills, role bullets, and certs as addressable facts', () => {
    const index = indexFacts(makeProfile())
    expect(index.byId.get('skill:0')).toBe('Azure')
    expect(index.byId.get('role:0:bullet:1')).toBe('Cut backup costs 30%')
    expect(index.byId.get('cert:0')).toBe('Azure Administrator Associate')
  })
})

describe('checkNoFabrication', () => {
  test('rejects a skill not present in the profile (factId null)', () => {
    const profile = makeProfile({ skills: ['Azure', 'VMware'] })
    const tailored = makeTailored({ claims: [{ text: 'Kubernetes', factId: null }] })
    const result = checkNoFabrication(tailored, profile)
    expect(result.ok).toBe(false)
    expect(result.unverifiable).toHaveLength(1)
  })

  test('grounds a skill that differs only in dash style (en-dash profile vs hyphen tailored)', () => {
    // The resume (from a .docx) holds an en-dash; the tailor drops it per the no-em-dash rule. The
    // skill is genuinely listed, so it must NOT read as fabricated.
    const profile = makeProfile({ skills: ['Windows Server 2012–2022', 'Azure'] })
    const tailored = makeTailored({ skills: ['Windows Server 2012-2022'], claims: [] })
    expect(checkNoFabrication(tailored, profile).ungroundedSkills).toHaveLength(0)
  })

  test('still rejects a skill whose words are genuinely absent (dash-folding is not a loophole)', () => {
    const profile = makeProfile({ skills: ['Azure', 'VMware'] })
    const tailored = makeTailored({ skills: ['Windows Server 2012-2022'], claims: [] })
    expect(checkNoFabrication(tailored, profile).ungroundedSkills).toContain('Windows Server 2012-2022')
  })

  test('a valid factId no longer launders fabricated claim text (B1-1: text must restate the cited fact)', () => {
    const profile = makeProfile({ skills: ['Azure'] }) // skill:0 = "Azure"
    const tailored = makeTailored({
      skills: [],
      claims: [{ text: 'Held a Top Secret clearance and led a team of 50', factId: 'skill:0' }],
    })
    const r = checkNoFabrication(tailored, profile)
    expect(r.ok).toBe(false)
    expect(r.unverifiable).toHaveLength(1)
  })

  test('a claim that faithfully restates its cited fact still passes', () => {
    const profile = makeProfile() // cert:0 = "Azure Administrator Associate"
    const tailored = makeTailored({ skills: [], claims: [{ text: 'Azure Administrator Associate', factId: 'cert:0' }] })
    expect(checkNoFabrication(tailored, profile).ok).toBe(true)
  })

  test('grounds skills whose edge chars are non-word — C++, C#, .NET, Node.js (C-1)', () => {
    const profile = makeProfile({ skills: ['C++', 'C#', '.NET', 'Node.js'] })
    const tailored = makeTailored({ skills: ['C++', 'C#', '.NET', 'Node.js'], claims: [] })
    expect(checkNoFabrication(tailored, profile).ungroundedSkills).toHaveLength(0)
  })

  test('still flags a symbol skill genuinely absent from the profile (C-1 not a loophole)', () => {
    const profile = makeProfile({ skills: ['Azure'] })
    const tailored = makeTailored({ skills: ['C++'], claims: [] })
    expect(checkNoFabrication(tailored, profile).ungroundedSkills).toContain('C++')
  })

  test('rejects a claim that references a non-existent factId', () => {
    const tailored = makeTailored({ claims: [{ text: 'Led a team of 10', factId: 'role:9:bullet:9' }] })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(false)
  })

  test('passes when every claim traces to a real fact', () => {
    const tailored = makeTailored({
      claims: [
        { text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:0' },
        { text: 'Azure Administrator Associate', factId: 'cert:0' },
      ],
    })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(true)
  })

  test('accepts a claim that verbatim-restates a fact even with a wrong/null factId', () => {
    // The model cited null but the text is an exact restatement of a real bullet, not fabricated.
    const tailored = makeTailored({ claims: [{ text: 'Migrated 40 VMs to Azure', factId: null }] })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(true)
  })

  test('accepts a claim that faithfully restates a real fact but cites the WRONG valid factId (mis-citation)', () => {
    // Regression for the "couldn't be traced back to your resume" false block: the model copied a real
    // bullet verbatim but attached a valid id for a DIFFERENT fact. The claim is truthful, so a
    // bookkeeping mis-cite must not block it, the fallback re-checks the text against every real fact.
    const tailored = makeTailored({
      // text == role:0:bullet:0 ("Migrated 40 VMs to Azure"), but points at cert:0 instead.
      claims: [{ text: 'Migrated 40 VMs to Azure', factId: 'cert:0' }],
    })
    expect(checkNoFabrication(tailored, makeProfile()).ok).toBe(true)
  })

  test('rejects a stripped fragment of a longer fact (factId null) — no one-directional substring pass', () => {
    const profile = makeProfile({
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure with zero data loss and full rollback coverage'],
        },
      ],
    })
    const tailored = makeTailored({ claims: [{ text: 'Migrated 40 VMs', factId: null }] })
    const result = checkNoFabrication(tailored, profile)
    expect(result.ok).toBe(false)
    expect(result.unverifiable).toHaveLength(1)
  })

  test('flags a tailored skill not grounded in any profile fact', () => {
    const tailored = makeTailored({ skills: ['Azure', 'Kubernetes'] })
    const result = checkNoFabrication(tailored, makeProfile())
    expect(result.ok).toBe(false)
    expect(result.ungroundedSkills).toContain('Kubernetes')
  })

  test('passes when tailored skills are all present in the profile', () => {
    const tailored = makeTailored({ skills: ['Azure', 'VMware'] })
    expect(checkNoFabrication(tailored, makeProfile()).ungroundedSkills).toEqual([])
  })

  test('flags an invented percentage in the summary (number absent from profile facts)', () => {
    // Profile bullets carry "40 VMs" and "30%"; 55% is fabricated.
    const tailored = makeTailored({ summary: 'Platform engineer who cut costs 55% last quarter.' })
    const result = checkNoFabrication(tailored, makeProfile())
    expect(result.ok).toBe(false)
    expect(result.ungroundedMetrics).toContain('55%')
  })

  test('passes a quantified claim whose number IS in the profile facts', () => {
    const tailored = makeTailored({ summary: 'Cut backup costs 30% and migrated 40 VMs.' })
    expect(checkNoFabrication(tailored, makeProfile()).ungroundedMetrics).toEqual([])
  })

  test('flags an invented scope/currency claim in the cover-letter body', () => {
    const tailored = makeTailored({
      coverLetter: 'I led a team of 12 and saved $2M in licensing for your team.',
    })
    const result = checkNoFabrication(tailored, makeProfile())
    expect(result.ok).toBe(false)
    expect(result.ungroundedMetrics.join(' ')).toMatch(/team of 12|\$2M/i)
  })

  test('does NOT gate bare counts or 4-digit years (too ambiguous)', () => {
    // "10 years" (years excluded) and "2 roles" (no scope unit) must not flag.
    const tailored = makeTailored({ summary: 'Over 10 years across 2 roles delivering Azure work.' })
    expect(checkNoFabrication(tailored, makeProfile()).ungroundedMetrics).toEqual([])
  })

  test('flags an invented metric in the outreach email body', () => {
    const tailored = makeTailored({
      outreach: { linkedin: 'Azure engineer keen to connect.', email: 'Hello, I saved $5M last year. Best, Jordan' },
    })
    const result = checkNoFabrication(tailored, makeProfile())
    expect(result.ok).toBe(false)
    expect(result.ungroundedMetrics.join(' ')).toMatch(/\$5M/i)
  })
})

// Regression: grounding a skill against the WHOLE flattened profile text let a disclaimer ground the
// very skill it denies. "No hands-on Kubernetes experience" wrongly grounded "Kubernetes". Grounding
// now runs fact-by-fact and skips any negated fact, so an explicitly-disclaimed skill stays ungrounded
// while a positively-stated one (skills list or a plain bullet) still grounds.
describe('checkNoFabrication: negation-aware grounding', () => {
  const negatedBullet = (bullet: string): Profile =>
    makeProfile({
      skills: ['Azure', 'VMware'],
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure', bullet],
        },
      ],
    })

  test('flags a skill whose only profile mention is inside a NEGATED fact', () => {
    const profile = negatedBullet('No hands-on Kubernetes experience')
    const result = checkNoFabrication(makeTailored({ skills: ['Kubernetes'], claims: [] }), profile)
    expect(result.ungroundedSkills).toContain('Kubernetes')
    expect(result.ok).toBe(false)
  })

  test('grounds the same skill when a NON-negated fact (skills list) also asserts it', () => {
    const profile = makeProfile({
      skills: ['Azure', 'VMware', 'Kubernetes'],
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure', 'No hands-on Kubernetes experience'],
        },
      ],
    })
    expect(checkNoFabrication(makeTailored({ skills: ['Kubernetes'], claims: [] }), profile).ungroundedSkills).toEqual([])
  })

  test('still grounds a positively-stated skill evidenced only in a plain bullet (Azure)', () => {
    const profile = makeProfile({
      skills: [],
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Led the Azure migration'],
        },
      ],
    })
    expect(checkNoFabrication(makeTailored({ skills: ['Azure'], claims: [] }), profile).ungroundedSkills).toEqual([])
  })
})

// The deterministic synonym safety net: a profile that spells a skill one way ("K8s") should ground a
// tailored skill spelled the equivalent way ("Kubernetes"), so a real, qualified candidate is not
// wrongly blocked as fabricating. It must compose with negation, not undermine it.
describe('checkNoFabrication: canonical synonym grounding', () => {
  test('a profile skill "K8s" grounds a tailored "Kubernetes" (alias, not fabrication)', () => {
    const profile = makeProfile({ skills: ['K8s', 'Azure'] })
    expect(checkNoFabrication(makeTailored({ skills: ['Kubernetes'], claims: [] }), profile).ungroundedSkills).toEqual([])
  })

  test('a NEGATED alias mention still fails to ground (synonym net composes with negation)', () => {
    const profile = makeProfile({
      skills: ['Azure', 'VMware'],
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure', 'No hands-on K8s experience'],
        },
      ],
    })
    const result = checkNoFabrication(makeTailored({ skills: ['Kubernetes'], claims: [] }), profile)
    expect(result.ungroundedSkills).toContain('Kubernetes')
    expect(result.ok).toBe(false)
  })
})

// Regression: the substring matcher false-positive-blocked faithful bullets when the tailor strips
// an em dash and rephrases (swaps ", " for "including"/a comma, drops a "(a, b, c)" parenthetical).
// These ARE in the resume, so they must trace; fabrications and meaning-flips must still be rejected.
describe('checkNoFabrication — faithful rephrasings (em-dash / parenthetical)', () => {
  const dashProfile = makeProfile({
    skills: [],
    roles: [
      {
        company: 'Signature',
        title: 'Cloud Engineer',
        startDate: '2024',
        endDate: null,
        bullets: [
          'Administer Microsoft Azure infrastructure and services — virtual machines, storage, and identity — aligned with HIPAA and NIST',
          'Led a zero-downtime migration to blade chassis architecture (compute, storage, network) with no business impact',
          'Did not complete the planned datacenter migration',
        ],
      },
    ],
  })
  const base = { summary: 'Cloud engineer.', skills: [] as string[] }

  test('accepts a bullet that swaps an em dash for "including"/a comma', () => {
    const tailored = makeTailored({
      ...base,
      claims: [
        {
          text: 'Administer Microsoft Azure infrastructure and services including virtual machines, storage, and identity, aligned with HIPAA and NIST',
          factId: 'role:0:bullet:0',
        },
      ],
    })
    expect(checkNoFabrication(tailored, dashProfile).ok).toBe(true)
  })

  test.each(['including', 'covering', 'spanning', 'comprising', 'encompassing'])(
    'accepts an em-dash list-gloss connector: "%s"',
    (connector) => {
      const compProfile = makeProfile({
        skills: [],
        roles: [
          {
            company: 'Conflux',
            title: 'Cloud Engineer',
            startDate: '2022',
            endDate: null,
            bullets: ['Supported compliance initiatives including HiTrust audits — documentation, evidence collection, and control validation'],
          },
        ],
      })
      const tailored = makeTailored({
        ...base,
        claims: [
          {
            text: `Supported compliance initiatives including HiTrust audits ${connector} documentation, evidence collection, and control validation`,
            factId: 'role:0:bullet:0',
          },
        ],
      })
      expect(checkNoFabrication(tailored, compProfile).ok).toBe(true)
    },
  )

  test('accepts a bullet that drops an internal parenthetical', () => {
    const tailored = makeTailored({
      ...base,
      claims: [
        { text: 'Led a zero-downtime migration to blade chassis architecture with no business impact', factId: 'role:0:bullet:1' },
      ],
    })
    expect(checkNoFabrication(tailored, dashProfile).ok).toBe(true)
  })

  test('still rejects a fabrication that adds a substantive word behind a connector', () => {
    const tailored = makeTailored({
      ...base,
      claims: [
        { text: 'Administer Microsoft Azure infrastructure and services including Kubernetes orchestration', factId: 'role:0:bullet:0' },
      ],
    })
    const r = checkNoFabrication(tailored, dashProfile)
    expect(r.ok).toBe(false)
    expect(r.unverifiable).toHaveLength(1)
  })

  test('still rejects a meaning flip that drops a negation ("did not" -> "did")', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Completed the planned datacenter migration', factId: 'role:0:bullet:2' }],
    })
    expect(checkNoFabrication(tailored, dashProfile).ok).toBe(false)
  })
})

// Regression: a faithful PARTIAL restatement of a LONG fact (the summary is the longest) covers well
// under 70% of that fact, which the old "covers >= 70% of the fact" rule wrongly rejected, so a
// near-verbatim summary claim blocked the whole packet. A substantial partial restatement must pass;
// a tiny sliver and a fabrication must still be rejected.
describe('checkNoFabrication — partial restatement of a long fact (summary)', () => {
  const longSummary =
    'Cloud and infrastructure engineer with over a decade running Microsoft Azure and hybrid on-prem ' +
    'environments in regulated industries, most recently federal healthcare under HIPAA, NIST 800-53, ' +
    'and FedRAMP. Hands-on across Azure networking and identity, security monitoring, VMware, and the ' +
    'backup and recovery posture underneath it all.'
  const longProfile = makeProfile({ summary: longSummary, skills: [] })

  test('accepts a verbatim prefix of the long summary cited against "summary"', () => {
    const tailored = makeTailored({
      summary: 'Cloud engineer.',
      skills: [],
      claims: [
        {
          text:
            'Cloud and infrastructure engineer with over a decade running Microsoft Azure and hybrid ' +
            'on-prem environments in regulated industries, most recently federal healthcare under HIPAA, ' +
            'NIST 800-53, and FedRAMP.',
          factId: 'summary',
        },
      ],
    })
    expect(checkNoFabrication(tailored, longProfile).ok).toBe(true)
  })

  test('accepts a substantial partial restatement that lightly rephrases the long summary', () => {
    const tailored = makeTailored({
      summary: 'Cloud engineer.',
      skills: [],
      claims: [
        {
          text: 'Cloud and infrastructure engineer running Microsoft Azure and hybrid on-prem environments in regulated industries',
          factId: 'summary',
        },
      ],
    })
    expect(checkNoFabrication(tailored, longProfile).ok).toBe(true)
  })

  test('still rejects a tiny sliver of the long summary (anti-fragment floor holds)', () => {
    const tailored = makeTailored({
      summary: 'Cloud engineer.',
      skills: [],
      claims: [{ text: 'Cloud and infrastructure engineer', factId: 'summary' }],
    })
    expect(checkNoFabrication(tailored, longProfile).ok).toBe(false)
  })

  test('still rejects a fabrication that adds a substantive word to the summary restatement', () => {
    const tailored = makeTailored({
      summary: 'Cloud engineer.',
      skills: [],
      claims: [
        {
          text: 'Cloud and infrastructure engineer running Microsoft Azure and Kubernetes across regulated industries',
          factId: 'summary',
        },
      ],
    })
    expect(checkNoFabrication(tailored, longProfile).ok).toBe(false)
  })
})

describe('checkBulletsGrounded (ai-26 — ground shipped bullets against the source resume)', () => {
  const SOURCE = [
    'Platform Engineer at Analytical Engines.',
    'Migrated 40 VMs to Azure and cut backup costs 30%.',
    'Maintained VMware clusters and disaster recovery runbooks.',
  ].join('\n')

  test('skips (degrades open) when no source text is available', () => {
    const r = checkBulletsGrounded(makeProfile(), undefined)
    expect(r).toEqual({ ok: true, skipped: true, ungroundedMetrics: [], flagged: [] })
  })

  test('passes when shipped bullets + their metrics trace to the source resume', () => {
    const r = checkBulletsGrounded(makeProfile(), SOURCE)
    expect(r.ok).toBe(true)
    expect(r.ungroundedMetrics).toEqual([])
  })

  test('BLOCKS an invented quantity introduced into a bullet (number absent from the source)', () => {
    // structureResume "embellished" a real bullet with a fabricated figure not in the source.
    const profile = makeProfile({
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure', 'Saved $2,000,000 in cloud spend'],
        },
      ],
    })
    const r = checkBulletsGrounded(profile, SOURCE)
    expect(r.ok).toBe(false)
    expect(r.ungroundedMetrics.join(' ')).toMatch(/2,000,000|2000000|\$/)
  })

  test('FLAGS (does not block) a bullet with low word-overlap to the source', () => {
    const profile = makeProfile({
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Spearheaded blockchain quantum cryptography orchestration initiatives'],
        },
      ],
      summary: undefined,
    })
    const r = checkBulletsGrounded(profile, SOURCE)
    expect(r.ok).toBe(true) // no invented metric -> not blocked
    expect(r.flagged.length).toBeGreaterThan(0) // but surfaced for review
    expect(r.flagged[0]?.overlap).toBeLessThan(0.5)
  })

  test('runGuardrails blocks overall when a bullet asserts an ungrounded metric', () => {
    const profile = makeProfile({
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Reduced incidents 95%'], // 95% appears nowhere in the source
        },
      ],
      summary: undefined,
    })
    const report = runGuardrails(makeTailored(), profile, { sourceResumeText: SOURCE })
    expect(report.bulletsGrounded.ok).toBe(false)
    expect(report.ok).toBe(false)
  })
})

describe('checkBannedTerms', () => {
  test('flags a banned term absent from the profile', () => {
    const tailored = makeTailored({ summary: 'Expert in Kubernetes and Azure.' })
    const result = checkBannedTerms(tailored, makeProfile(), ['Kubernetes', 'Docker'])
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('Kubernetes')
  })

  test('allows a watched term that IS present in the profile', () => {
    const profile = makeProfile({ skills: ['Azure', 'VMware', 'Kubernetes'] })
    const tailored = makeTailored({ summary: 'Expert in Kubernetes and Azure.' })
    expect(checkBannedTerms(tailored, profile, ['Kubernetes']).ok).toBe(true)
  })

  test('flags a watched term whose only profile mention is inside a NEGATED fact', () => {
    // "No production Kubernetes experience" must not license shipping "Kubernetes" in the output.
    const profile = makeProfile({
      skills: ['Azure', 'VMware'],
      roles: [
        {
          company: 'Analytical Engines',
          title: 'Platform Engineer',
          startDate: '2022',
          endDate: null,
          bullets: ['Migrated 40 VMs to Azure', 'No production Kubernetes experience'],
        },
      ],
    })
    const tailored = makeTailored({ summary: 'Expert in Kubernetes and Azure.' })
    const result = checkBannedTerms(tailored, profile, ['Kubernetes'])
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('Kubernetes')
  })
})

describe('checkStyle', () => {
  test('flags em dashes by default', () => {
    expect(checkStyle('I led the team — and shipped.').ok).toBe(false)
  })

  test('passes clean prose', () => {
    expect(checkStyle('I led the team and shipped.').ok).toBe(true)
  })

  test('flags repeated spaces within a line', () => {
    expect(checkStyle('I led  the team.').ok).toBe(false)
  })

  test('does NOT flag newlines or blank-line paragraph breaks', () => {
    expect(checkStyle('First paragraph.\n\nSecond paragraph.').ok).toBe(true)
  })
})

describe('checkAtsSafe', () => {
  test('flags tables, images, and multi-column layouts', () => {
    const result = checkAtsSafe({ columns: 2, hasTables: true, hasImages: true, textRunCount: 5 })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(
      expect.arrayContaining(['multi-column layout', 'contains tables', 'contains images']),
    )
  })

  test('passes a single-column, text-only document', () => {
    expect(checkAtsSafe({ columns: 1, hasTables: false, hasImages: false, textRunCount: 12 }).ok).toBe(true)
  })
})

describe('runGuardrails', () => {
  test('passes a faithful, clean packet', () => {
    const report = runGuardrails(makeTailored(), makeProfile(), {
      bannedTerms: ['Kubernetes'],
      atsDoc: { columns: 1, hasTables: false, hasImages: false, textRunCount: 20 },
    })
    expect(report.ok).toBe(true)
  })

  test('fails the whole report if any single check fails', () => {
    const tailored = makeTailored({ claims: [{ text: 'Kubernetes', factId: null }] })
    const report = runGuardrails(tailored, makeProfile())
    expect(report.ok).toBe(false)
    expect(report.noFabrication.ok).toBe(false)
  })

  test('an em dash in an outreach message trips the style check', () => {
    const tailored = makeTailored({
      outreach: { linkedin: 'Azure engineer — keen to connect.', email: 'Hello, glad to connect. Best, Jordan' },
    })
    const report = runGuardrails(tailored, makeProfile())
    expect(report.style.ok).toBe(false)
    expect(report.ok).toBe(false)
  })

  test('cert-status is a NON-blocking flag — a suspicious cert does not fail the report', () => {
    // Inputs kept clean for every OTHER check so only certStatus trips, proving it doesn't block.
    const profile = makeProfile({
      summary: 'Cloud engineer.',
      skills: ['Azure'],
      roles: [{ company: 'Acme', title: 'Cloud Engineer', startDate: '2022', endDate: null, bullets: ['Ran Azure infrastructure'] }],
      certs: [{ name: 'AWS Solutions Architect', status: 'active' }],
    })
    const tailored = makeTailored({ summary: 'Cloud engineer.', skills: ['Azure'], claims: [], coverLetter: 'I bring Azure experience.' })
    const source = 'Cloud engineer. Ran Azure infrastructure. CERTIFICATIONS PREVIOUSLY HELD AWS Solutions Architect.'
    const report = runGuardrails(tailored, profile, { sourceResumeText: source })
    expect(report.certStatus.ok).toBe(false)
    expect(report.certStatus.suspicious).toContain('AWS Solutions Architect')
    expect(report.ok).toBe(true) // flag only, packet still ships
  })
})

describe('checkCertStatus', () => {
  const profile = (certs: Profile['certs']) => makeProfile({ certs })

  test('flags an active cert that the source lists under a Previously-Held heading', () => {
    const source = 'Active\n- VCP-DCV\nPREVIOUSLY HELD\n- AWS Solutions Architect Associate\n- CCNA (held 5 years)'
    const r = checkCertStatus(
      profile([
        { name: 'VCP-DCV', status: 'active' },
        { name: 'AWS Solutions Architect Associate', status: 'active' },
        { name: 'CCNA', status: 'active' },
      ]),
      source,
    )
    expect(r.suspicious).toEqual(
      expect.arrayContaining(['AWS Solutions Architect Associate', 'CCNA']),
    )
    expect(r.suspicious).not.toContain('VCP-DCV')
  })

  test('flags an inline "(expired)" cue even without a heading', () => {
    const r = checkCertStatus(profile([{ name: 'CISSP', status: 'active' }]), 'Certifications: CISSP (expired 2023)')
    expect(r.suspicious).toContain('CISSP')
  })

  test('does not flag a cert already classified previously_held (rendered correctly)', () => {
    const source = 'PREVIOUSLY HELD\n- AWS Solutions Architect Associate'
    const r = checkCertStatus(profile([{ name: 'AWS Solutions Architect Associate', status: 'previously_held' }]), source)
    expect(r.ok).toBe(true)
    expect(r.suspicious).toHaveLength(0)
  })

  test('clean active certs are not flagged', () => {
    const r = checkCertStatus(profile([{ name: 'VCP-DCV', status: 'active' }]), 'Certifications (Active):\n- VCP-DCV')
    expect(r.ok).toBe(true)
  })

  test('skips (degrades open) when no source resume is available', () => {
    const r = checkCertStatus(profile([{ name: 'VCP-DCV', status: 'active' }]), undefined)
    expect(r).toEqual({ ok: true, skipped: true, suspicious: [] })
  })
})

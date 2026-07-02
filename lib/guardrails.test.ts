import { describe, expect, test } from 'vitest'
import type { Profile, TailoredContent } from '@/lib/schemas'
import {
  checkAtsSafe,
  checkBannedTerms,
  checkBulletsGrounded,
  checkCertStatus,
  checkEducationGrounded,
  checkNoFabrication,
  checkStyle,
  indexFacts,
  mentions,
  mentionsAny,
  runGuardrails,
  surfacedForms,
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

// Finding 9: metric grounding is now KIND-aware (dollar / percent / team / count-of-unit) and compares
// NORMALIZED numeric values, closing both a fall-open (a dollar figure grounding off a same-numbered
// count) and a fall-closed (shorthand vs full-digits of the same money value being treated as different).
describe('checkNoFabrication: kind-aware, value-normalized metric grounding (finding 9)', () => {
  const dollarFact = (bullet: string): Profile =>
    makeProfile({
      skills: [],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: [bullet] }],
    })

  test('fall-open: invented "$40M" is NOT grounded by an unrelated "40 VMs" count', () => {
    // makeProfile carries "Migrated 40 VMs to Azure"; the digits coincide but the kinds differ.
    const tailored = makeTailored({ coverLetter: 'I delivered $40M in savings.' })
    const r = checkNoFabrication(tailored, makeProfile())
    expect(r.ok).toBe(false)
    expect(r.ungroundedMetrics.join(' ')).toMatch(/\$40M/i)
  })

  test('fall-closed: "$1.5M" IS grounded by a fact stating "$1,500,000" (same value, different form)', () => {
    const tailored = makeTailored({ coverLetter: 'I saved $1.5M in licensing.' })
    expect(checkNoFabrication(tailored, dollarFact('Saved the company $1,500,000 in licensing')).ungroundedMetrics).toEqual([])
  })

  test('also grounds "$1.5 million" against a "$1,500,000" fact (spelled-out shorthand)', () => {
    const tailored = makeTailored({ coverLetter: 'I saved $1.5 million in licensing.' })
    expect(checkNoFabrication(tailored, dollarFact('Saved the company $1,500,000 in licensing')).ungroundedMetrics).toEqual([])
  })

  test('a count still grounds a count of the SAME unit + value ("40 VMs" vs "40 vms")', () => {
    const tailored = makeTailored({ summary: 'Migrated 40 VMs across the estate.' })
    expect(checkNoFabrication(tailored, makeProfile()).ungroundedMetrics).toEqual([])
  })

  // Regression: a genuinely ungrounded metric is still flagged, one case per kind.
  test('still flags an ungrounded DOLLAR metric (no matching money value in facts)', () => {
    const r = checkNoFabrication(makeTailored({ coverLetter: 'Saved $7M.' }), dollarFact('Saved the company $1,500,000 in licensing'))
    expect(r.ungroundedMetrics.join(' ')).toMatch(/\$7M/i)
  })

  test('still flags an ungrounded PERCENT metric', () => {
    // makeProfile has "Cut backup costs 30%"; 77% is not present.
    const r = checkNoFabrication(makeTailored({ summary: 'Cut costs 77%.' }), makeProfile())
    expect(r.ungroundedMetrics).toContain('77%')
  })

  test('still flags an ungrounded TEAM-size metric', () => {
    const r = checkNoFabrication(makeTailored({ coverLetter: 'Led a team of 25.' }), makeProfile())
    expect(r.ungroundedMetrics.join(' ')).toMatch(/team of 25/i)
  })

  test('still flags an ungrounded COUNT metric (unit present in facts, value not)', () => {
    // Facts have "40 VMs"; "200 servers" is a different unit and value, so it must not ground.
    const r = checkNoFabrication(makeTailored({ summary: 'Managed 200 servers.' }), makeProfile())
    expect(r.ungroundedMetrics.join(' ')).toMatch(/200 servers/i)
  })

  test('a count does NOT ground a different unit with the same value ("40 VMs" != "40 servers")', () => {
    const r = checkNoFabrication(makeTailored({ summary: 'Managed 40 servers.' }), makeProfile())
    expect(r.ungroundedMetrics.join(' ')).toMatch(/40 servers/i)
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

// Finding 3 (relational-order sensitivity): Route 2's token-faithfulness is bag-of-words, so without
// the directional-pair guard a "from X to Y" whose X and Y are SWAPPED reads as a faithful paraphrase
// (identical token set, identical empty negation key). The guard requires each half of a directional
// pair present in BOTH the fact and the claim to bind to the SAME phrase. Reorders and rephrasings
// with no directional relationship must be unaffected.
describe('checkNoFabrication: relational/directional order (from/to, before/after)', () => {
  const dirProfile = makeProfile({
    skills: [],
    roles: [
      {
        company: 'Meridian',
        title: 'Data Engineer',
        startDate: '2021',
        endDate: null,
        bullets: [
          'Led migration from Oracle to PostgreSQL',
          'Deployed the app before the audit and archived logs after the migration',
          'Managed storage, compute, and networking',
        ],
      },
    ],
  })
  const base = { summary: 'Data engineer.', skills: [] as string[] }

  test('rejects a from/to inversion (roles swapped, identical token set)', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Led migration from PostgreSQL to Oracle', factId: 'role:0:bullet:0' }],
    })
    expect(checkNoFabrication(tailored, dirProfile).ok).toBe(false)
  })

  test('accepts a role-preserving reorder of the same from/to fact ("to Y from X")', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Led migration to PostgreSQL from Oracle', factId: 'role:0:bullet:0' }],
    })
    expect(checkNoFabrication(tailored, dirProfile).ok).toBe(true)
  })

  test('generalizes to another directional pair: rejects a before/after inversion', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Deployed the app before the migration and archived logs after the audit', factId: 'role:0:bullet:1' }],
    })
    expect(checkNoFabrication(tailored, dirProfile).ok).toBe(false)
  })

  test('generalizes to another directional pair: accepts a role-preserving before/after rephrase', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Deployed the app before the audit, archived logs after the migration', factId: 'role:0:bullet:1' }],
    })
    expect(checkNoFabrication(tailored, dirProfile).ok).toBe(true)
  })

  test('leaves a NON-directional reorder untouched (list order swap, no from/to)', () => {
    const tailored = makeTailored({
      ...base,
      claims: [{ text: 'Managed compute, storage, and networking', factId: 'role:0:bullet:2' }],
    })
    expect(checkNoFabrication(tailored, dirProfile).ok).toBe(true)
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

  test('detects a banned term shipping ONLY as its curated alias (output "K8s", banned "Kubernetes")', () => {
    // Alias-consistency: detection must be as alias-aware as grounding. A profile with no Kubernetes
    // and no K8s cannot license the alias form, so shipping "K8s" trips the banned "Kubernetes".
    const noK8s = makeProfile({ skills: ['Azure'] })
    const tailored = makeTailored({ summary: 'K8s operations engineer.', skills: ['Azure'] })
    const result = checkBannedTerms(tailored, noK8s, ['Kubernetes'])
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('Kubernetes')
  })

  test('does NOT flag a banned term alias that IS grounded (output "K8s", profile holds "K8s")', () => {
    // Regression: the alias-aware detection must not become a false positive. When the profile itself
    // holds the alias, both halves agree the term is licensed, so it is not a violation.
    const hasK8s = makeProfile({ skills: ['K8s'] })
    const tailored = makeTailored({ summary: 'K8s operations engineer.', skills: ['K8s'] })
    expect(checkBannedTerms(tailored, hasK8s, ['Kubernetes']).ok).toBe(true)
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

  test('a cert present in the source is not flagged as not-found (regression)', () => {
    const r = checkCertStatus(profile([{ name: 'VCP-DCV', status: 'active' }]), 'Certifications (Active):\n- VCP-DCV')
    expect(r.notFound).toEqual([])
    expect(r.ok).toBe(true)
  })

  test('a cert entirely absent from the source is flagged in notFound, not silently skipped', () => {
    const r = checkCertStatus(
      profile([{ name: 'VCP-DCV', status: 'active' }, { name: 'CISSP', status: 'active' }]),
      'Certifications (Active):\n- VCP-DCV', // CISSP appears nowhere
    )
    expect(r.notFound).toEqual(['CISSP'])
    expect(r.suspicious).toEqual([])
    expect(r.ok).toBe(false) // non-blocking, but the flag is raised
  })

  test('a dash/punctuation variant is still found, not a false notFound (normalize consistency)', () => {
    // profile "AZ-104" normalizes to "az 104"; the raw source keeps the dash ("az-104"). The old
    // lower.indexOf("az 104") missed it and would have reported a false notFound; mentions() does not.
    const r = checkCertStatus(profile([{ name: 'AZ-104', status: 'active' }]), 'Certifications: AZ-104 (2021)')
    expect(r.notFound).toEqual([])
  })

  test('skips (degrades open) when no source resume is available', () => {
    const r = checkCertStatus(profile([{ name: 'VCP-DCV', status: 'active' }]), undefined)
    expect(r).toEqual({ ok: true, skipped: true, suspicious: [], notFound: [] })
  })
})

describe('checkEducationGrounded', () => {
  const eduProfile = (education: Profile['education']) => makeProfile({ education })
  const SOURCE = 'B.S. in Computer Science, Riverside State University, 2014. Minor in Mathematics.'

  test('an entry with strong source overlap is not flagged', () => {
    const r = checkEducationGrounded(
      eduProfile([{ school: 'Riverside State University', degree: 'B.S.', field: 'Computer Science', year: '2014' }]),
      SOURCE,
    )
    expect(r.ok).toBe(true)
    expect(r.flagged).toEqual([])
  })

  test('an entry with little source overlap is flagged, but ok stays true (non-blocking)', () => {
    const r = checkEducationGrounded(
      eduProfile([{ school: 'Oxford University', degree: 'PhD', field: 'Astrophysics', year: '2010' }]),
      SOURCE,
    )
    expect(r.flagged.length).toBe(1)
    expect(r.flagged[0]?.overlap).toBeLessThan(0.5)
    expect(r.ok).toBe(true) // flag only, never blocks
  })

  test('skips (degrades open) when no source resume is available', () => {
    const r = checkEducationGrounded(
      eduProfile([{ school: 'Oxford University', degree: 'PhD', field: 'Astrophysics', year: '2010' }]),
      undefined,
    )
    expect(r).toEqual({ ok: true, skipped: true, flagged: [] })
  })
})

describe('surfacedForms', () => {
  test('splits the "JobForm (FactForm)" alias-pairing shape into two forms', () => {
    expect(surfacedForms('Kubernetes (K8s)')).toEqual(['Kubernetes', 'K8s'])
    expect(surfacedForms('Security+ (SY0-601)')).toEqual(['Security+', 'SY0-601'])
  })
  test('a plain skill is a single form', () => {
    expect(surfacedForms('Azure')).toEqual(['Azure'])
    expect(surfacedForms('VMware vSphere')).toEqual(['VMware vSphere'])
  })
})

describe('checkNoFabrication skill grounding (alias-pairing for external ATS)', () => {
  test('a fact "K8s" + JD "Kubernetes" may ship "Kubernetes (K8s)" and passes as grounded', () => {
    const profile = makeProfile({ skills: ['K8s'] })
    const tailored = makeTailored({ skills: ['Kubernetes (K8s)'], claims: [] })
    const r = checkNoFabrication(tailored, profile)
    expect(r.ungroundedSkills).toEqual([])
    expect(r.ok).toBe(true)
  })

  test('the single JD form alone ("Kubernetes" for a "K8s" fact) is still grounded (unchanged)', () => {
    const r = checkNoFabrication(makeTailored({ skills: ['Kubernetes'], claims: [] }), makeProfile({ skills: ['K8s'] }))
    expect(r.ungroundedSkills).toEqual([])
  })

  test('BOUNDARY: pairing a fact skill with a DIFFERENT technology is still flagged ungrounded', () => {
    // "Docker" is not a curated alias of "Kubernetes", so the parenthetical cannot smuggle it in.
    const r = checkNoFabrication(makeTailored({ skills: ['Kubernetes (Docker)'], claims: [] }), makeProfile({ skills: ['K8s'] }))
    expect(r.ungroundedSkills).toEqual(['Kubernetes (Docker)'])
    expect(r.ok).toBe(false)
  })

  test('BOUNDARY: a plausible-looking form that is NOT in the curated alias table is flagged', () => {
    // "Kube" superficially looks like a Kubernetes alias but is not in the curated table -> ungrounded.
    const r = checkNoFabrication(makeTailored({ skills: ['Kubernetes (Kube)'], claims: [] }), makeProfile({ skills: ['K8s'] }))
    expect(r.ungroundedSkills).toEqual(['Kubernetes (Kube)'])
  })

  test('BOUNDARY: surfacing a JD form for a skill the candidate does NOT hold is flagged', () => {
    // Same-canonical forms, but neither traces to a real fact (profile holds Terraform, not Kubernetes).
    const r = checkNoFabrication(makeTailored({ skills: ['Kubernetes (K8s)'], claims: [] }), makeProfile({ skills: ['Terraform'] }))
    expect(r.ungroundedSkills).toEqual(['Kubernetes (K8s)'])
    expect(r.ok).toBe(false)
  })

  test('REGRESSION: a term with no alias entry behaves exactly as before (grounded vs genuine gap)', () => {
    const held = checkNoFabrication(makeTailored({ skills: ['Terraform'], claims: [] }), makeProfile({ skills: ['Terraform'] }))
    expect(held.ungroundedSkills).toEqual([])
    const gap = checkNoFabrication(makeTailored({ skills: ['Ansible'], claims: [] }), makeProfile({ skills: ['Terraform'] }))
    expect(gap.ungroundedSkills).toEqual(['Ansible'])
  })

  test('REGRESSION: a parenthetical that is itself a verbatim fact (a versioned cert) stays grounded', () => {
    const profile = makeProfile({ certs: [{ name: 'Security+ (SY0-601)' }] })
    const r = checkNoFabrication(makeTailored({ skills: ['Security+ (SY0-601)'], claims: [] }), profile)
    expect(r.ungroundedSkills).toEqual([])
  })
})

describe('mentions() dotted-identifier boundary (finding 10)', () => {
  test('"js" does NOT match inside a dotted product name (vue/node/express/next .js)', () => {
    for (const name of ['vue.js', 'node.js', 'express.js', 'next.js']) {
      expect(mentions(name, 'js')).toBe(false)
    }
  })

  test('a Vue.js-only fact does NOT ground "JavaScript" (alias-aware, agrees with canonical impl)', () => {
    expect(mentionsAny('built dashboards in vue.js', 'JavaScript')).toBe(false)
  })

  test('"JS" as a genuinely standalone term still matches (word-flanked and sentence-final)', () => {
    expect(mentions('proficient in js and python', 'JS')).toBe(true)
    expect(mentions('strong front-end work in js.', 'JS')).toBe(true) // trailing period is not a compound
  })

  test('a term that legitimately contains/starts with a dot still matches itself', () => {
    expect(mentions('experience with node.js on the backend', 'Node.js')).toBe(true)
    expect(mentions('shipped services on .net', '.NET')).toBe(true)
  })

  test('does not match a term forming the first half of a dotted compound (js.foo)', () => {
    expect(mentions('wrote js.worker glue code', 'js')).toBe(false)
  })

  test('end-to-end: a Vue.js-only profile leaves a tailored "JavaScript" skill ungrounded', () => {
    const profile = makeProfile({
      skills: ['Vue.js'],
      roles: [{ company: 'Co', title: 'Eng', startDate: '2020', endDate: null, bullets: ['Built dashboards in Vue.js'] }],
    })
    const r = checkNoFabrication(makeTailored({ skills: ['JavaScript'], claims: [] }), profile)
    expect(r.ungroundedSkills).toEqual(['JavaScript'])
  })
})

describe('checkNoFabrication multi-word boundary matching (finding 1)', () => {
  test('a MySQL-only fact set does NOT ground a "SQL Server" claim (no phrase-inside-a-word match)', () => {
    const profile = makeProfile({
      skills: ['MySQL Server'],
      roles: [
        {
          company: 'Acme',
          title: 'DBA',
          startDate: '2020',
          endDate: null,
          bullets: ['Administered MySQL Server databases for three teams'],
        },
      ],
    })
    const r = checkNoFabrication(makeTailored({ skills: ['SQL Server'], claims: [] }), profile)
    expect(r.ungroundedSkills).toEqual(['SQL Server'])
    expect(r.ok).toBe(false)
  })

  test('"virtual machinery" does NOT ground the "virtual machine"/"VMs" alias family', () => {
    const profile = makeProfile({
      skills: [],
      roles: [
        {
          company: 'Acme',
          title: 'Engineer',
          startDate: '2020',
          endDate: null,
          bullets: ['Maintained the virtual machinery lab'],
        },
      ],
    })
    const r = checkNoFabrication(makeTailored({ skills: ['VMs'], claims: [] }), profile)
    expect(r.ungroundedSkills).toEqual(['VMs'])
  })

  test('a genuine multi-word skill still grounds with the anchored phrase match (no regression)', () => {
    const profile = makeProfile({
      skills: [],
      roles: [
        {
          company: 'Acme',
          title: 'DBA',
          startDate: '2020',
          endDate: null,
          bullets: ['Tuned SQL Server stored procedures.'],
        },
      ],
    })
    // Mid-sentence with a trailing period: boundaries must accept space/punctuation neighbors.
    expect(checkNoFabrication(makeTailored({ skills: ['SQL Server'], claims: [] }), profile).ungroundedSkills).toEqual([])
  })
})

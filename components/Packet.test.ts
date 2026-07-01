import { describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PacketView from '@/components/Packet'
import { runGuardrails } from '@/lib/guardrails'
import { assessFit, type FitInput } from '@/lib/fit/fitScore'
import type { Packet, PacketDocuments } from '@/lib/services/buildPacket'
import type { JobReqs, Profile, TailoredContent } from '@/lib/schemas'
import type { StyleRecord } from '@/lib/style/types'

// posthog-js is browser-only and only fires on a click handler (never during a static render), but
// stub it so importing the client component can never touch a browser global under the node env.
vi.mock('posthog-js', () => ({ default: { init: () => {}, capture: () => {} } }))

// A fully-scored fit input (mirrors lib/fit/fitPresent.test.ts) so assessFit emits a real result.
const fitInput: FitInput = {
  roleTypeMatch: 'best',
  mustHaveSkills: ['azure', 'windows server'],
  candidateSkills: ['azure', 'windows server'],
  seniorityMatch: 'exact',
  compTopUsd: 180_000,
  targetCompTopUsd: 170_000,
  employerType: 'direct',
  location: 'remote_us',
  vertical: 'match',
  requiredCerts: ['security+'],
  heldCerts: ['security+'],
}
const fit = assessFit(fitInput)

const profile: Profile = {
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
}

const jobReqs: JobReqs = { title: 'Cloud Engineer', company: 'Acme', mustHave: ['azure'], niceToHave: [] }
const style: StyleRecord = { theme: 'navy_copper', font: 'cambria_calibri', source: 'default' }

const cleanTailored: TailoredContent = {
  summary: 'Platform Engineer with Azure experience.',
  skills: ['Azure', 'VMware'],
  claims: [{ text: 'Migrated 40 VMs to Azure', factId: 'role:0:bullet:0' }],
  coverLetter: 'I would be glad to bring my Azure experience to your team.',
  outreach: { linkedin: 'Azure engineer keen to connect.', email: 'Hello, I bring Azure experience. Best, Ada' },
}
// Kubernetes is not in the profile, so no-fabrication fails and the packet is held back.
const failedTailored: TailoredContent = { ...cleanTailored, skills: ['Azure', 'Kubernetes'] }

const atsDoc = { columns: 1, hasTables: false, hasImages: false, textRunCount: 5 }
const cleanGuardrails = runGuardrails(cleanTailored, profile, { atsDoc })
const failedGuardrails = runGuardrails(failedTailored, profile, { atsDoc })

const docFormats = (stem: string) => ({
  pdf: { filename: `${stem}.pdf`, mime: 'application/pdf', base64: 'AA' },
  docx: { filename: `${stem}.docx`, mime: 'application/vnd.openxmlformats', base64: 'AA' },
})
const documents: PacketDocuments = {
  storage: 'inline',
  resume: docFormats('Resume'),
  coverLetter: docFormats('Cover'),
  fitAssessment: docFormats('Fit'),
}

const render = (packet: Packet) => renderToStaticMarkup(createElement(PacketView, { packet }))
const HELD_BACK = 'Held back for review'

describe('PacketView held-back indicator', () => {
  test('a clean packet renders the fit score with no held-back banner', () => {
    expect(cleanGuardrails.ok).toBe(true)
    const packet: Packet = {
      profile,
      jobReqs,
      fit,
      fitInput,
      tailored: cleanTailored,
      guardrails: cleanGuardrails,
      documents,
      style,
    }
    const html = render(packet)
    expect(html).toContain(`aria-valuenow="${fit.overall}"`) // the score gauge renders
    expect(html).not.toContain(HELD_BACK)
  })

  test('a blocked packet (guardrails.ok false, documents null) shows the held-back indicator alongside the score', () => {
    expect(failedGuardrails.ok).toBe(false)
    const packet: Packet = {
      profile,
      jobReqs,
      fit,
      fitInput,
      tailored: failedTailored,
      guardrails: failedGuardrails,
      documents: null,
      style,
    }
    const html = render(packet)
    // Score is still shown (flag, do not hide) AND it is paired with the review indicator + a reason.
    expect(html).toContain(`aria-valuenow="${fit.overall}"`)
    expect(html).toContain(HELD_BACK)
    expect(html).toContain('We held this packet back to keep it accurate')
  })
})

// Packet pipeline orchestrator (Engineering Plan §5). Sequences the individually-tested
// steps, then runs the deterministic guardrails. Doc generation (.docx) + Storage upload
// land in the docgen slice; the /api/packet route that calls this sets runtime='nodejs'.
import { structureResume } from './structureResume'
import { parseJob } from './parseJob'
import { scoreFit } from './scoreFit'
import { tailorResume } from './tailorResume'
import { runGuardrails, type GuardrailReport } from '@/lib/guardrails'
import { BANNED_TERMS, STYLE_RULES } from '@/lib/profileRules'
import type { FitScore, JobReqs, Profile, TailoredContent } from '@/lib/schemas'

export interface PacketInput {
  resumeText: string
  jdText: string
  /** Sensitive terms that may appear only if present in the profile (e.g. ['Kubernetes']). */
  bannedTerms?: string[]
}

export interface Packet {
  profile: Profile
  jobReqs: JobReqs
  fit: FitScore
  tailored: TailoredContent
  guardrails: GuardrailReport
}

/**
 * Run the hero pipeline end to end. The returned `guardrails.ok` is the ship/block signal:
 * a failed no-fabrication check must NOT be shipped silently — the route returns it for
 * regeneration or human review (Engineering Plan §6).
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  const profile = await structureResume(input.resumeText)
  const jobReqs = await parseJob(input.jdText)

  // Independent steps — run concurrently.
  const [fit, tailored] = await Promise.all([
    scoreFit(profile, jobReqs),
    tailorResume(profile, jobReqs),
  ])

  const guardrails = runGuardrails(tailored, profile, {
    // Default to the standing banned terms (no Kubernetes/Docker/etc.); callers may extend.
    bannedTerms: input.bannedTerms ?? BANNED_TERMS,
    style: { allowEmDash: STYLE_RULES.allowEmDash },
  })

  return { profile, jobReqs, fit, tailored, guardrails }
}

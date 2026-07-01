// Role discovery, stage 2 of 2: the Claude RE-RANK contract + pure result assembly.
//
// The pre-filter (prefilter.ts) hands a high-recall candidate set to Claude, which judges true
// similarity to the candidate's experience ACROSS title variance and returns a relevance score +
// a one-line rationale per role. The model only ranks ids we gave it, assembleDiscoveries rejects
// any hallucinated id and rejoins the model's verdict with the real posting data.
import * as z from 'zod'
import type { ScoredJob } from './prefilter'

export const RoleRankSchema = z.object({
  roles: z.array(
    z.object({
      /** Must echo one of the candidate ids we supplied. */
      id: z.string(),
      /** 0–100: how well this role matches the candidate's actual experience. */
      score: z.number().min(0).max(100),
      /** One sentence: why it fits, naming the title-variance link when relevant. */
      reason: z.string(),
    }),
  ),
})
export type RoleRank = z.infer<typeof RoleRankSchema>

/** A discovered role: the real posting plus Claude's relevance verdict, ready for the UI. */
export interface DiscoveredRole {
  id: string
  provider: string
  title: string
  company: string
  location: string | null
  url: string
  /** Claude's similarity score (0–100). */
  score: number
  /** Claude's one-line "why it matches" rationale. */
  reason: string
}

/**
 * Rejoin the model's ranking with the real candidate postings. Pure + deterministic:
 * - drops any id the model invented (not in the candidate set),
 * - de-dupes if the model lists an id twice (keeps the first/highest),
 * - sorts by score desc, then returns the top N.
 */
export function assembleDiscoveries(ranked: RoleRank, candidates: ScoredJob[], topN: number): DiscoveredRole[] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: DiscoveredRole[] = []
  for (const r of ranked.roles) {
    const job = byId.get(r.id)
    if (!job || seen.has(r.id)) continue
    seen.add(r.id)
    out.push({
      id: job.id,
      provider: job.provider,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      score: Math.round(r.score),
      reason: r.reason,
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, topN)
}

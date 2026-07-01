// Phase 2 entry point: read the Phase 1 raw candidates and write a DRAFT reviewed file with a
// recommendation + reason per pair. This does NOT touch lib/skillAliases.ts and nothing here is
// trusted automatically, the user reviews and edits candidate-aliases-reviewed.json before Phase 3.
// Run with: npm run skills:review  (tsx scripts/skills/reviewCandidates.ts)
import { readFileSync, writeFileSync } from 'node:fs'
import { reviewAll, type Candidate, type Recommendation } from './review'

const IN_PATH = 'scripts/skills/candidate-aliases.json'
const OUT_PATH = 'scripts/skills/candidate-aliases-reviewed.json'

interface CandidateFile {
  candidates: Candidate[]
}

function main(): void {
  const raw = JSON.parse(readFileSync(IN_PATH, 'utf8')) as CandidateFile
  const reviewed = reviewAll(raw.candidates ?? [])

  const counts: Record<Recommendation, number> = { 'needs-human-judgment': 0, reject: 0, approve: 0 }
  for (const r of reviewed) counts[r.recommendation]++

  const output = {
    note: 'DRAFT recommendations (Phase 2). Not a merge list. Review and edit before Phase 3 promotes anything into lib/skillAliases.ts. Sorted so needs-human-judgment and reject appear first.',
    counts: { ...counts, total: reviewed.length },
    reviewed,
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
  console.log(
    `[skills] wrote ${OUT_PATH}: ${reviewed.length} pairs ` +
      `(needs-human-judgment ${counts['needs-human-judgment']}, reject ${counts.reject}, approve ${counts.approve})`,
  )
}

main()

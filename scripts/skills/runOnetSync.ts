// Scheduled O*NET sync entry point (run by .github/workflows/onet-sync.yml, or manually via
// npm run skills:sync-onet). Reads the manifest, checks for a newer O*NET release, and on a new
// release writes the four PR artifacts (updated CSV + manifest, triaged new candidates, stale report)
// and the PR body. It NEVER modifies lib/skillAliases.ts and NEVER merges: the workflow opens a DRAFT
// PR for human review. When the release is unchanged it writes nothing, so no PR is opened.
import { readFileSync, writeFileSync } from 'node:fs'
import { runSync, type OnetManifest } from './onetSync'
import { reviewAll, type Recommendation } from './review'

const MANIFEST_PATH = 'scripts/skills/data/onet-manifest.json'
const CSV_PATH = 'scripts/skills/data/onet-software-skills.csv'
const REVIEWED_PATH = 'scripts/skills/onet-new-candidates-reviewed.json'
const STALE_PATH = 'scripts/skills/onet-stale-report.json'

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as OnetManifest
  // Real network only here; the pure logic (onetSync.runSync) takes an injected fetch so CI can mock it.
  const result = await runSync(manifest, (url: string) => fetch(url))

  if (!result.changed) {
    console.log(`[onet-sync] up to date: manifest ${result.currentVersion}, detected ${result.detectedVersion ?? 'unknown'}. No changes, no PR.`)
    return
  }

  writeFileSync(CSV_PATH, result.newCsv ?? '')
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(result.updatedManifest, null, 2)}\n`)

  const reviewed = reviewAll(result.newCandidates)
  const counts: Record<Recommendation, number> = { 'needs-human-judgment': 0, reject: 0, approve: 0 }
  for (const r of reviewed) counts[r.recommendation]++
  writeFileSync(
    REVIEWED_PATH,
    `${JSON.stringify({ note: 'DRAFT triage of candidates NEW in this O*NET release. Not trusted automatically; review before any merge into lib/skillAliases.ts.', onetVersion: result.detectedVersion, counts: { ...counts, total: reviewed.length }, reviewed }, null, 2)}\n`,
  )
  writeFileSync(
    STALE_PATH,
    `${JSON.stringify({ note: 'Entries no longer confirmed by the latest O*NET release. Informational only, NOT auto-removed (a term can still be real and in use).', onetVersion: result.detectedVersion, count: result.staleEntries.length, staleEntries: result.staleEntries }, null, 2)}\n`,
  )

  // The workflow points PR_BODY_PATH at a temp file (outside the repo) so the body is not committed.
  const bodyPath = process.env.PR_BODY_PATH
  if (bodyPath) writeFileSync(bodyPath, `${result.prBody ?? ''}\n`)
  else console.log(result.prBody)

  console.log(`[onet-sync] ${result.currentVersion} -> ${result.detectedVersion}: ${result.newCandidates.length} new candidates, ${result.staleEntries.length} stale. Artifacts written for a DRAFT PR (human review required).`)
}

main().catch((err) => {
  console.error('[onet-sync] failed:', err)
  process.exitCode = 1
})

// Phase 1 entry point: build scripts/skills/candidate-aliases.json from the two free sources
// (O*NET Software Skills + Stack Exchange tag synonyms). RAW CANDIDATES ONLY. Nothing here is
// deduped, filtered, or wired into lib/skillAliases.ts, that is Phase 2. Run with:
//   npm run skills:candidates   (tsx scripts/skills/buildAliasCandidates.ts)
//
// O*NET is read from the committed CSV (no network). Stack Exchange is a live fetch; if it fails
// (offline / rate limited), we still write the O*NET candidates so the file is always produced.
import { readFileSync, writeFileSync } from 'node:fs'
import { extractOnetCandidates, type OnetCandidate } from './onet'
import { collectStackExchangeCandidates, type SynonymCandidate } from './stackexchange'
import { SEED_TAGS } from './seedTags'

const CSV_PATH = 'scripts/skills/data/onet-software-skills.csv'
const OUT_PATH = 'scripts/skills/candidate-aliases.json'

async function main(): Promise<void> {
  const csv = readFileSync(CSV_PATH, 'utf8')
  const onet = extractOnetCandidates(csv)
  const byTier = (t: OnetCandidate['confidence']) => onet.filter((c) => c.confidence === t).length
  console.log(
    `[skills] O*NET candidates: ${onet.length} ` +
      `(parenthetical ${byTier('parenthetical')}, initials-exact ${byTier('initials-exact')}, ` +
      `initials-substring ${byTier('initials-substring')})`,
  )

  let stackexchange: SynonymCandidate[] = []
  try {
    stackexchange = await collectStackExchangeCandidates(SEED_TAGS)
    console.log(`[skills] Stack Exchange candidates: ${stackexchange.length}`)
  } catch (err) {
    console.warn('[skills] Stack Exchange fetch failed, writing O*NET-only candidates:', err)
  }

  const candidates = [...onet, ...stackexchange]
  const output = {
    note: 'RAW candidate aliases (Phase 1). Not deduped, not filtered, not trusted. Review in Phase 2.',
    counts: { onet: onet.length, stackexchange: stackexchange.length, total: candidates.length },
    candidates,
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`[skills] wrote ${OUT_PATH} (${candidates.length} candidates)`)
}

main().catch((err) => {
  console.error('[skills] failed to build candidates:', err)
  process.exitCode = 1
})

// O*NET release sync (detection + re-extraction + diff). Automates keeping the O*NET-derived alias
// candidates current across O*NET releases (29.0, 29.3, 30.2, 30.3, ...), which do NOT follow a fixed
// calendar. It does NOT decide the merge: the output is a reviewable draft PR, exactly like the manual
// bootstrap (#143-147). Merging approved candidates into lib/skillAliases.ts stays a separate,
// explicit human step. This module is the PURE, injectable logic; runOnetSync.ts wires it to I/O and
// the GitHub Actions workflow opens the PR.
//
// Reuses the existing toolchain rather than reimplementing: extractOnetCandidates (parenthetical +
// initials-verified trailing-acronym extraction) and reviewAll (heuristic triage).
import { normalize } from '@/lib/guardrails'
import { extractOnetCandidates, type OnetCandidate } from './onet'
import { reviewAll, type Recommendation } from './review'

/** Compare two O*NET version strings ("30.3" vs "30.2"). Returns -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

/**
 * Extract the latest O*NET database version from the db_releases page HTML (or an API JSON body).
 * Primary signal: download-file URLs embed the version as `db_<major>_<minor>_` (e.g. db_30_3_excel);
 * this is stable and unambiguous. Falls back to bare "MM.m" version tokens. Returns the max version,
 * or null when none is found (caller treats null as "could not detect", a soft failure, not "no new
 * release"). Verify the page/URL shape at first real run; the parser is deliberately pattern-based so a
 * layout tweak that keeps the db_<M>_<m>_ download links still works.
 */
export function parseLatestVersion(html: string): string | null {
  const found = new Set<string>()
  for (const m of html.matchAll(/db_(\d+)_(\d+)_/g)) found.add(`${m[1]}.${m[2]}`)
  if (found.size === 0) {
    // Fallback: explicit version tokens near release wording (e.g. "Version 30.3"). Bounded to a
    // plausible O*NET major (>= 20) so a stray "3.1" in unrelated copy is not mistaken for a release.
    for (const m of html.matchAll(/\b(\d{2,})\.(\d+)\b/g)) {
      if (Number(m[1]) >= 20) found.add(`${m[1]}.${m[2]}`)
    }
  }
  if (found.size === 0) return null
  return [...found].sort(compareVersions).at(-1) ?? null
}

// ---- manifest ---------------------------------------------------------------------

export interface ManifestEntry {
  /** Stable identity: normalized full|acronym, so re-runs match the same pair across releases. */
  key: string
  full: string
  acronym: string
  confidence: OnetCandidate['confidence']
  /** O*NET release this pair was first seen in. */
  firstSeenVersion: string
  /** Latest O*NET release this pair was confirmed present in. */
  lastConfirmedVersion: string
}

export interface OnetManifest {
  note?: string
  /** The O*NET release currently reflected in scripts/skills/data/onet-software-skills.csv. */
  onetVersion: string
  source?: string
  entries: ManifestEntry[]
}

/** Stable key for an extracted candidate: normalized full + acronym. */
export function candidateKey(c: { full: string; acronym: string }): string {
  return `${normalize(c.full)}|${normalize(c.acronym)}`
}

/** Build a manifest from a CSV's extracted candidates, stamping every entry with `version`. */
export function buildManifest(csvText: string, version: string): OnetManifest {
  const entries = extractOnetCandidates(csvText).map((c) => ({
    key: candidateKey(c),
    full: c.full,
    acronym: c.acronym,
    confidence: c.confidence,
    firstSeenVersion: version,
    lastConfirmedVersion: version,
  }))
  return {
    note: 'Tracks the O*NET release reflected in onet-software-skills.csv and, per extracted candidate, the release it was first seen in and last confirmed present in. Updated by the scheduled O*NET sync; never edited by hand.',
    onetVersion: version,
    source: 'scripts/skills/data/onet-software-skills.csv',
    entries,
  }
}

export interface ManifestDiff {
  /** Candidates in the fresh extraction not previously in the manifest (route through review). */
  newCandidates: OnetCandidate[]
  /** Manifest entries NOT present in the fresh extraction (informational; NOT auto-removed). */
  staleEntries: ManifestEntry[]
  /** Manifest advanced to the new release: existing-and-present entries get lastConfirmedVersion
   *  bumped, new entries appended, stale entries retained with their old lastConfirmedVersion. */
  updatedManifest: OnetManifest
}

/** Diff a fresh extraction against the manifest and produce the advanced manifest. Pure. */
export function diffManifest(manifest: OnetManifest, freshCandidates: OnetCandidate[], newVersion: string): ManifestDiff {
  const seen = new Map(manifest.entries.map((e) => [e.key, e]))
  const fresh = new Map(freshCandidates.map((c) => [candidateKey(c), c]))

  const newCandidates = freshCandidates.filter((c) => !seen.has(candidateKey(c)))
  const staleEntries = manifest.entries.filter((e) => !fresh.has(e.key))

  const updatedEntries: ManifestEntry[] = [
    ...manifest.entries.map((e) => (fresh.has(e.key) ? { ...e, lastConfirmedVersion: newVersion } : e)),
    ...newCandidates.map((c) => ({
      key: candidateKey(c),
      full: c.full,
      acronym: c.acronym,
      confidence: c.confidence,
      firstSeenVersion: newVersion,
      lastConfirmedVersion: newVersion,
    })),
  ]

  return {
    newCandidates,
    staleEntries,
    updatedManifest: { ...manifest, onetVersion: newVersion, entries: updatedEntries },
  }
}

// ---- fetch (injectable; mocked in tests, never a live call in CI) ------------------

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

const RELEASES_URL = 'https://www.onetcenter.org/db_releases.html'
// O*NET publishes a tab-delimited TEXT distribution alongside the Excel one; the text file needs no
// binary parser, so we prefer it. Verify the URL/columns at first real run.
const softwareSkillsUrl = (version: string) =>
  `https://www.onetcenter.org/dl_files/database/db_${version.replace('.', '_')}_text/Software%20Skills.txt`

/** Detect the current O*NET release. Returns null if it could not be determined (soft failure). */
export async function detectLatestVersion(fetchImpl: FetchLike): Promise<string | null> {
  const res = await fetchImpl(RELEASES_URL)
  if (!res.ok) throw new Error(`O*NET releases page returned HTTP ${res.status}`)
  return parseLatestVersion(await res.text())
}

/**
 * Trim a raw O*NET Software Skills distribution (parsed rows) to the committed CSV's shape: dedupe to
 * distinct product names, keep Element Name / Hot Technology / In Demand, drop the occupation mapping
 * (SOC code + title). Column names follow O*NET's text distribution; adjust the mapping if the schema
 * changes. Returns rows as objects matching the committed CSV header.
 */
export function trimSoftwareSkills(rawRows: Record<string, string>[]): Record<string, string>[] {
  const seen = new Set<string>()
  const out: Record<string, string>[] = []
  for (const r of rawRows) {
    const example = (r['Example'] ?? r['Workplace Example'] ?? '').trim()
    if (!example) continue
    const key = normalize(example)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      'Workplace Example': example,
      'Element Name': (r['Commodity Title'] ?? r['Element Name'] ?? '').trim(),
      'Hot Technology': (r['Hot Technology'] ?? 'N').trim() || 'N',
      'In Demand': (r['In Demand'] ?? 'N').trim() || 'N',
    })
  }
  return out
}

/** Serialize trimmed rows back to CSV text in the committed column order (quoting fields with commas). */
export function toCsv(rows: Record<string, string>[]): string {
  const header = ['Workplace Example', 'Element Name', 'Hot Technology', 'In Demand']
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [header.join(',')]
  for (const r of rows) lines.push(header.map((h) => cell(r[h] ?? '')).join(','))
  return `${lines.join('\n')}\n`
}

/** Parse O*NET's tab-delimited text distribution (no field quoting) into header-keyed rows. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0)
  const header = (lines[0] ?? '').split('\t')
  return lines.slice(1).map((line) => {
    const cells = line.split('\t')
    const obj: Record<string, string> = {}
    header.forEach((h, i) => {
      obj[h] = cells[i] ?? ''
    })
    return obj
  })
}

/** Download + trim the Software Skills file for a version, returning the committed-shape CSV text. */
export async function fetchSoftwareSkillsCsv(version: string, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(softwareSkillsUrl(version))
  if (!res.ok) throw new Error(`O*NET Software Skills ${version} returned HTTP ${res.status}`)
  return toCsv(trimSoftwareSkills(parseTsv(await res.text())))
}

// ---- orchestration ----------------------------------------------------------------

export interface SyncResult {
  /** True only when a newer release was detected and re-extracted (the PR-worthy case). */
  changed: boolean
  detectedVersion: string | null
  currentVersion: string
  newCandidates: OnetCandidate[]
  staleEntries: ManifestEntry[]
  updatedManifest: OnetManifest | null
  /** Fresh committed-shape CSV for the new release (null when unchanged). */
  newCsv: string | null
  /** Draft-PR body markdown (null when unchanged). */
  prBody: string | null
}

/** Render the draft-PR body: version bump, new-candidate triage counts, stale entries, and the
 *  standing rule that this NEVER auto-merges into lib/skillAliases.ts (human review required). */
export function renderPrBody(from: string, to: string, newCandidates: OnetCandidate[], staleEntries: ManifestEntry[]): string {
  const reviewed = reviewAll(newCandidates)
  const counts: Record<Recommendation, number> = { 'needs-human-judgment': 0, reject: 0, approve: 0 }
  for (const r of reviewed) counts[r.recommendation]++
  const staleList = staleEntries.slice(0, 40).map((e) => `- ${e.full} (${e.acronym}), last confirmed in ${e.lastConfirmedVersion}`).join('\n')

  return [
    `## O*NET ${from} to ${to}: alias-candidate sync`,
    '',
    `The scheduled O*NET sync detected release **${to}** (was **${from}**), re-extracted the Software`,
    'Skills candidates with the existing toolchain, and diffed them against the manifest.',
    '',
    '> This is a REVIEWABLE DRAFT. It does NOT modify `lib/skillAliases.ts`. Merging any new candidate',
    "> into the alias table stays a separate, explicit human step (the same Phase-3 merge #145 did),",
    '> because that table feeds the no-fabrication guardrail. Do not auto-merge.',
    '',
    '### Artifacts in this PR',
    '- `scripts/skills/data/onet-software-skills.csv` updated to release ' + to,
    '- `scripts/skills/data/onet-manifest.json` advanced to release ' + to,
    '- `scripts/skills/onet-new-candidates-reviewed.json`: the new candidates, heuristic-triaged',
    '- `scripts/skills/onet-stale-report.json`: entries no longer confirmed by the latest release',
    '',
    `### New candidates: ${newCandidates.length}`,
    `needs-human-judgment ${counts['needs-human-judgment']}, reject ${counts.reject}, approve ${counts.approve}. Review \`onet-new-candidates-reviewed.json\`; nothing here is trusted automatically.`,
    '',
    `### No longer confirmed by ${to}: ${staleEntries.length}`,
    'Informational only, NOT auto-removed (a term can still be real and in use even if this survey',
    'cycle did not include it). Full list in `onet-stale-report.json`.',
    staleEntries.length > 0 ? '' : '(none)',
    staleList,
  ].join('\n')
}

/** Detect, and if a newer release exists, re-extract + diff. Pure of filesystem (fetch is injected),
 *  so tests drive both the "no new release" and "new release" scenarios without a live call. */
export async function runSync(manifest: OnetManifest, fetchImpl: FetchLike): Promise<SyncResult> {
  const detectedVersion = await detectLatestVersion(fetchImpl)
  const currentVersion = manifest.onetVersion
  if (!detectedVersion || compareVersions(detectedVersion, currentVersion) <= 0) {
    return { changed: false, detectedVersion, currentVersion, newCandidates: [], staleEntries: [], updatedManifest: null, newCsv: null, prBody: null }
  }
  const newCsv = await fetchSoftwareSkillsCsv(detectedVersion, fetchImpl)
  const fresh = extractOnetCandidates(newCsv)
  const { newCandidates, staleEntries, updatedManifest } = diffManifest(manifest, fresh, detectedVersion)
  return {
    changed: true,
    detectedVersion,
    currentVersion,
    newCandidates,
    staleEntries,
    updatedManifest,
    newCsv,
    prBody: renderPrBody(currentVersion, detectedVersion, newCandidates, staleEntries),
  }
}

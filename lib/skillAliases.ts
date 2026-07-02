// Deterministic skill/cert synonym safety net (no fuzzy matching, no model call, no randomness).
// Skill comparison happens by EXACT token in two places, fitScore.coverage() and guardrails
// mentions()-based grounding, so a real, qualified candidate can be under-scored or wrongly blocked
// purely because the resume and the JD spell a skill differently ("K8s" vs "Kubernetes"). The
// extraction prompts already ask for canonical tokens; this is the code-level backstop for when that
// canonicalization is imperfect.
//
// Purely ADDITIVE: a term not in the curated table behaves exactly as before (normalize only). Only
// genuinely UNAMBIGUOUS pairs belong here, when in doubt leave a pair out rather than risk a false
// match (e.g. "TS" is deliberately excluded, it collides with TS/SCI clearances; "Go" and bare
// "Node" are excluded as everyday words / cluster-node collisions).
//
// Self-contained on purpose: normalizeTerm mirrors guardrails.normalize but is kept local so this
// stays a dependency-free leaf (guardrails imports THIS, so importing guardrails back would cycle).

/** Lowercase and fold whitespace + every hyphen/dash variant to a single space. Mirrors
 *  guardrails.normalize so the forms here compare consistently with mentions()/coverage(). */
function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s‐-―−-]+/g, ' ') // whitespace + hyphen/dash variants (U+2010 to U+2015, minus sign, ASCII hyphen)
    .trim()
}

// Each group is one equivalence class: [canonical, ...synonyms]. Compared after normalizeTerm, so
// write forms in their natural spelling (dots/slashes are preserved by normalize, only dashes fold).
export const CORE_ALIAS_GROUPS: string[][] = [
  ['kubernetes', 'k8s'],
  ['javascript', 'js'],
  ['amazon web services', 'aws'],
  ['google cloud platform', 'gcp'],
  ['microsoft azure', 'azure'],
  ['infrastructure as code', 'iac'],
  ['continuous integration and continuous deployment', 'ci/cd', 'cicd'],
  ['machine learning', 'ml'],
  ['artificial intelligence', 'ai'],
  ['.net', 'dotnet'],
  ['postgresql', 'postgres'],
  ['mongodb', 'mongo'],
  ['node.js', 'nodejs'],
  ['virtual machines', 'virtual machine', 'vms', 'vm'],
  // VMware's virtualization platform: ESXi is the hypervisor, vSphere the suite built on it. A JD and
  // a resume routinely name the same skill differently ("VMware ESXi" vs "vSphere / ESXi"), so treat
  // these spellings as one. Deliberately NOT including the generic "virtualization" (vendor-neutral,
  // also covers Hyper-V/KVM/containers) nor bare "VMware" (spans Workstation/NSX/vSAN).
  // Normalize preserves slashes and only folds whitespace, so both slash spacings are listed.
  ['vmware esxi', 'esxi', 'vmware vsphere', 'vsphere', 'vsphere/esxi', 'vsphere / esxi', 'vmware vsphere/esxi', 'vmware vsphere / esxi'],
]

// Approved imports from the O*NET / Stack Exchange bootstrap (scripts/skills, Phases 1-2). Each pair
// was user-signed-off and hand-filtered to a genuine spelling/abbreviation variant of ONE skill, held
// to the same unambiguous bar as the core table. Stack Exchange tag synonyms only: every O*NET
// parenthetical candidate was a short collision-prone acronym (EMR/IMS/GCE/CNS/...) and was excluded,
// as were Stack Overflow sub-topic/version tags (jdk, php-fpm, angular2) and pairs already in core.
export const IMPORTED_ALIAS_GROUPS: string[][] = [
  // Stack Exchange: React spellings, "react" is the resume-facing form, "reactjs"/"react.js" the SO/npm ones.
  ['react', 'reactjs', 'react.js'],
  // Stack Exchange: Vue.js written several ways for the one framework.
  ['vue.js', 'vue', 'vuejs'],
  // Stack Exchange: Next.js dotted vs undotted spelling.
  ['next.js', 'nextjs'],
  // Stack Exchange: Microsoft SQL Server, "MSSQL" is the ubiquitous short form of the same product.
  ['sql server', 'mssql', 'ms sql server'],
  // Stack Exchange: scikit-learn and its import-name abbreviation "sklearn".
  ['scikit-learn', 'sklearn'],
  // Stack Exchange: Apache Hadoop with or without the "Apache" vendor prefix.
  ['hadoop', 'apache hadoop'],
  // Stack Exchange: Apache Kafka with or without the prefix ("Kafka" is unambiguous in a tech context).
  ['apache kafka', 'kafka'],
  // Stack Exchange: Salesforce and its salesforce.com domain spelling.
  ['salesforce', 'salesforce.com'],
  // Stack Exchange: PowerShell and its "Windows PowerShell" full name.
  ['powershell', 'windows powershell'],
  // Stack Exchange: C++ and its ASCII-safe short forms "cpp"/"cxx" (unambiguous, unlike bare "C").
  ['c++', 'cpp', 'cxx'],
]

// The active table is the core hand-authored groups plus the approved imports. Pure data merge, the
// canonicalize/aliasForms logic below is unchanged. Exported so a test can assert no term maps to two
// different canonical forms.
export const ALIAS_GROUPS: string[][] = [...CORE_ALIAS_GROUPS, ...IMPORTED_ALIAS_GROUPS]

/** Content-addressed identity of the alias table: a deterministic hash of ALIAS_GROUPS' contents.
 *  FNV-1a (32-bit) over the groups' JSON, pure and dependency-free so this module stays a browser-safe
 *  leaf (no node:crypto): skillAliases is pulled into client components transitively via fitPresent. */
export function computeAliasTableVersion(groups: readonly (readonly string[])[]): string {
  const s = JSON.stringify(groups)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 't-' + (h >>> 0).toString(16).padStart(8, '0')
}

/** The current alias table's version, derived AUTOMATICALLY from its contents at module load so it can
 *  never silently go stale. This is the deliberate design choice for this finding: a hand-bumped
 *  constant has exactly the forget-to-bump failure mode the finding is about, and the Phase 8 automated
 *  refresh pipeline changes ALIAS_GROUPS without a human necessarily editing a version line. Pairs with
 *  fitScore.RUBRIC_VERSION and is orthogonal to it: RUBRIC_VERSION identifies the scoring FORMULA (a
 *  deliberate, human, semantic change), ALIAS_TABLE_VERSION identifies the alias TABLE the formula
 *  reads through canonicalize(). A fit score is fully reproducible only for a fixed (input,
 *  RUBRIC_VERSION, ALIAS_TABLE_VERSION) triple. */
export const ALIAS_TABLE_VERSION = computeAliasTableVersion(ALIAS_GROUPS)

// normalizedForm -> canonical normalized form (self-contained, safe to build at module load).
const CANON = new Map<string, string>()
// canonical normalized form -> every normalized form in its group (for the grounding fallback).
const FORMS = new Map<string, string[]>()
for (const group of ALIAS_GROUPS) {
  const forms = group.map(normalizeTerm)
  const canon = forms[0] as string
  for (const form of forms) CANON.set(form, canon)
  FORMS.set(canon, forms)
}

/** Normalize `term`, then collapse it to its curated canonical form when one exists; otherwise
 *  return the normalized term unchanged. Two terms are equivalent iff their canonicals are equal,
 *  which is how coverage() compares the required and held/adjacent sets. */
export function canonicalize(term: string): string {
  const n = normalizeTerm(term)
  return CANON.get(n) ?? n
}

/** Every normalized surface form equivalent to `term` (including itself). A single-element array when
 *  the term is not in the table (so an alias-aware mentions() degrades to a plain mentions()). Used by
 *  the grounding fallback to try "k8s" when the term is "kubernetes" and vice versa. */
export function aliasForms(term: string): string[] {
  const n = normalizeTerm(term)
  const canon = CANON.get(n)
  if (!canon) return [n]
  return FORMS.get(canon) ?? [n]
}

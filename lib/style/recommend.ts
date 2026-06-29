/**
 * ScoutLane style recommender — lib/style/recommend.ts
 *
 * Pure function: given fit-engine signals (industry/domain, seniority, roleType),
 * returns a recommended {theme, font} pair plus a full ranking of all 10 options
 * on each axis. Always also returns the master safe default (navy_copper / cambria_calibri).
 *
 * Algorithm:
 *   1. Map domain → industry (thin adapter; unknown falls back to 'default')
 *   2. Look up formality target for the industry (1 modern … 5 traditional)
 *   3. Nudge formality by seniority
 *   4. Score each theme/font:
 *        tagScore     = number of bestFor tags matching industry/seniority/roleType × 2
 *        formalScore  = MAX_FORMALITY − |item.formality − target|   (themes get a proxy)
 *        total        = tagScore + formalScore
 *   5. Pick top-scored theme + top-scored font; return with why-string and full rankings.
 *
 * Known tuning issue: tahoma_tahoma over-scores for engineer roles due to tag overlap.
 * Fix: weight industry tags above role tags, penalise high-distinct for conservative
 * industries, add canonical unit tests BEFORE changing weights.
 *
 * @module
 */

import themes from './themes.json';
import fonts from './fonts.json';
import type {
  Theme,
  FontPair,
  RecommendInput,
  RecommendResult,
  RankedTheme,
  RankedFont,
  Seniority,
  RoleType,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MASTER_THEME = 'navy_copper';
const MASTER_FONT = 'cambria_calibri';
const MAX_FORMALITY = 5;

/** Fixed safe default — always returned alongside the recommendation. */
const SAFE_DEFAULT = { theme: MASTER_THEME, font: MASTER_FONT } as const;

// ---------------------------------------------------------------------------
// Domain → industry adapter
// ---------------------------------------------------------------------------

/**
 * Maps the fit engine's domain/vertical labels to the recommender's industry
 * key space. Case-insensitive partial matching via the table below.
 *
 * Add rows as new fit-engine domain labels are discovered in production.
 * Unknown domains fall back to 'default' (resolves to master).
 */
const DOMAIN_MAP: Array<[RegExp, string]> = [
  // Insurance
  [/insurance|underwriting|actuarial/i, 'insurance'],
  // Finance / banking / investment
  [/financ|banking|investment|wealth|capital market|asset management|private equity|hedge/i, 'finance'],
  // Legal / compliance
  [/legal|compliance|regulatory|law firm|attorney|counsel/i, 'legal'],
  // Healthcare / pharma / biotech
  [/health|medical|clinical|pharma|biotech|life science|hospital|nursing/i, 'healthcare'],
  // Manufacturing / industrial
  [/manufactur|industrial|automotive|aerospace|defense|logistics|supply chain|warehouse/i, 'manufacturing'],
  // Operations / facilities
  [/operations|facilities|real estate|property management/i, 'operations'],
  // Sustainability / nonprofit / education
  [/sustainability|environmental|nonprofit|non.profit|education|university|academic|school/i, 'nonprofit'],
  // Cloud / platform / devops
  [/cloud|platform engineering|infrastructure|devops|site reliability|sre|devsecops/i, 'cloud'],
  // Software / startups / engineering
  [/software|startup|saas|tech startup|engineering|product engineering/i, 'tech'],
  // General tech / IT
  [/technology|information technology|it services|managed service|consulting/i, 'tech'],
  // Sales / marketing / media
  [/sales|marketing|advertising|media|creative agency/i, 'sales'],
  // HR / people ops
  [/human resources|hr|people operations|talent|recruiting/i, 'hr'],
];

/**
 * Convert a fit-engine domain/vertical label to an industry key.
 * Returns 'default' for unrecognised domains.
 */
export function domainToIndustry(domain: string | undefined | null): string {
  if (!domain) return 'default';
  for (const [pattern, industry] of DOMAIN_MAP) {
    if (pattern.test(domain)) return industry;
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// Industry → formality target
// ---------------------------------------------------------------------------

/**
 * Base formality target per industry (1 = most modern, 5 = most traditional).
 * Seniority nudges this up/down before scoring.
 */
const INDUSTRY_FORMALITY: Record<string, number> = {
  legal:         5,
  finance:       4,
  insurance:     4,
  consulting:    4,
  government:    4,
  healthcare:    3,
  manufacturing: 3,
  operations:    3,
  nonprofit:     3,
  hr:            3,
  general:       3,
  default:       3,
  sales:         2,
  tech:          2,
  cloud:         2,
  devops:        2,
};

/** Seniority nudges to formality (added to industry base, clamped to [1, 5]) */
const SENIORITY_NUDGE: Record<string, number> = {
  executive:  1,
  principal:  1,
  director:   1,
  staff:      0.5,
  senior:     0,
  mid:        0,
  junior:    -0.5,
  entry:     -1,
};

// ---------------------------------------------------------------------------
// Role-type tag affinities
// ---------------------------------------------------------------------------

/**
 * Extra bestFor tags injected when a role type matches.
 * These are added to the match-set so industry tags still dominate;
 * role tags provide a secondary tiebreaker.
 */
const ROLE_TAGS: Partial<Record<RoleType, string[]>> = {
  'engineer':            ['software', 'engineering orgs', 'startups'],
  'devops':              ['devops', 'cloud', 'platform engineering', 'tech-leaning'],
  'cloud':               ['cloud', 'devops', 'platform engineering', 'tech-leaning'],
  'data':                ['software', 'tech', 'engineering orgs'],
  'security':            ['tech-leaning', 'regulated', 'it-ops'],
  'it-ops':              ['IT', 'tech-leaning', 'managed service'],
  'engineering-manager': ['leadership', 'senior', 'engineering orgs'],
  'product':             ['modern enterprise', 'tech-leaning', 'startups'],
  'design':              ['design-aware', 'creative-adjacent', 'startups'],
  'finance':             ['finance', 'insurance', 'regulated'],
  'legal':               ['legal', 'finance', 'government', 'conservative'],
  'operations':          ['operations', 'manufacturing', 'mid-market'],
  'sales':               ['sales-adjacent', 'competitive roles', 'high-visibility'],
  'hr':                  ['people-centric', 'nonprofit', 'small companies'],
};

// ---------------------------------------------------------------------------
// Theme formality proxy
// ---------------------------------------------------------------------------

/**
 * Themes don't carry a formality score in the JSON, so we assign one here
 * based on the industry context captured in bestFor.
 *
 * Conservative industries = high formality; tech/bold = low formality.
 */
const THEME_FORMALITY: Record<string, number> = {
  navy_copper:       4, // insurance, finance, regulated
  ink_teal:          2, // cloud, devops, tech
  charcoal_amber:    3, // versatile
  forest_stone:      3, // healthcare, manufacturing, ops
  oxford_burgundy:   5, // executive, legal, finance
  slate_rust:        2, // mid-market, modern
  graphite_electric: 1, // startups, software
  espresso_sage:     2, // small companies, people-centric
  midnight_gold:     5, // executive, prestige
  steel_crimson:     2, // competitive, bold
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Count how many of `item.bestFor` tags appear in the match set.
 * Industry tags count; role tags also count but industry still dominates
 * because industry-based tags are typically more specific.
 */
function tagScore(bestFor: string[], matchSet: Set<string>): number {
  let score = 0;
  for (const tag of bestFor) {
    if (matchSet.has(tag.toLowerCase())) score += 2;
  }
  return score;
}

/** Formality closeness: higher = closer to target. Range [0, MAX_FORMALITY]. */
function formalScore(itemFormality: number, target: number): number {
  return MAX_FORMALITY - Math.abs(itemFormality - target);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Recommend a {theme, font} for the given fit-engine signals.
 *
 * @example
 * const result = recommend({ domain: 'cloud computing', seniority: 'senior', roleType: 'devops' });
 * // result.recommended → { theme: 'ink_teal', font: 'tahoma_tahoma' | 'calibri_calibri', why: '...' }
 *
 * @example
 * const result = recommend({}); // unknown → master
 * // result.recommended.theme === 'navy_copper'
 */
export function recommend(input: RecommendInput): RecommendResult {
  const { domain, seniority, roleType } = input;

  // 1. Resolve industry
  const industry = input.industry ?? domainToIndustry(domain);

  // 2. Formality target
  // noUncheckedIndexedAccess: INDUSTRY_FORMALITY is Record<string,number> so both sides
  // of ?? are number|undefined. Hard-code the terminal fallback (3 = default) to guarantee number.
  const baseFormality = INDUSTRY_FORMALITY[industry] ?? 3;
  const nudge = seniority ? (SENIORITY_NUDGE[seniority] ?? 0) : 0;
  const formalityTarget = clamp(baseFormality + nudge, 1, MAX_FORMALITY);

  // 3. Build match tag set (lowercase for case-insensitive matching)
  const matchSet = new Set<string>();
  matchSet.add(industry.toLowerCase());
  // Add role-type affinities (secondary — industry still dominates via specificity)
  if (roleType) {
    for (const tag of (ROLE_TAGS[roleType] ?? [])) {
      matchSet.add(tag.toLowerCase());
    }
  }
  // Seniority-derived tags
  if (seniority === 'executive' || seniority === 'principal' || seniority === 'director') {
    matchSet.add('executive');
    matchSet.add('leadership');
    matchSet.add('senior');
    matchSet.add('director-level');
  } else if (seniority === 'senior' || seniority === 'staff') {
    matchSet.add('senior');
  }

  // 4a. Score themes
  const themeRanking: RankedTheme[] = (themes.themes as Theme[]).map((theme) => {
    const tTags = tagScore(
      theme.bestFor.map((t) => t.toLowerCase()),
      matchSet,
    );
    const tFormal = formalScore(THEME_FORMALITY[theme.id] ?? 3, formalityTarget);
    return { theme, score: tTags + tFormal };
  });
  themeRanking.sort((a, b) => b.score - a.score || a.theme.order - b.theme.order);

  // 4b. Score fonts
  const fontRanking: RankedFont[] = (fonts.pairs as FontPair[]).map((font) => {
    const fTags = tagScore(
      font.bestFor.map((t) => t.toLowerCase()),
      matchSet,
    );
    const fFormal = formalScore(font.formality, formalityTarget);
    return { font, score: fTags + fFormal };
  });
  fontRanking.sort((a, b) => b.score - a.score || a.font.order - b.font.order);

  // 5. Best picks
  // noUncheckedIndexedAccess: index [0] on RankedTheme[] / RankedFont[] returns T|undefined.
  // The arrays are always length 10 (one entry per theme/font in the JSON) so this is
  // unreachable, but the guard satisfies the compiler and catches corruption early.
  const bestThemeEntry = themeRanking[0];
  const bestFontEntry = fontRanking[0];
  if (!bestThemeEntry || !bestFontEntry) {
    throw new Error('Style data is empty — themes.json or fonts.json may be corrupted');
  }
  const bestTheme = bestThemeEntry.theme;
  const bestFont = bestFontEntry.font;

  // 6. Why string
  const why = buildWhyString(bestTheme, bestFont, industry, formalityTarget, seniority, roleType);

  return {
    recommended: {
      theme: bestTheme.id,
      font: bestFont.id,
      why,
    },
    safeDefault: SAFE_DEFAULT,
    themeRanking,
    fontRanking,
  };
}

// ---------------------------------------------------------------------------
// Why-string builder
// ---------------------------------------------------------------------------

function buildWhyString(
  theme: Theme,
  font: FontPair,
  industry: string,
  formalityTarget: number,
  seniority?: Seniority,
  roleType?: RoleType,
): string {
  const industryLabel = industry === 'default' ? 'general roles' : industry;
  const seniorityLabel = seniority ? ` ${seniority}-level` : '';
  const formalLabel = formalityTarget >= 4 ? 'traditional' : formalityTarget <= 2 ? 'modern' : 'balanced';

  return (
    `${theme.name} + ${font.name} — matched to${seniorityLabel} ${industryLabel} ` +
    `(${formalLabel} formality). ${theme.recruiter ?? ''}`
  ).trim();
}

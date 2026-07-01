/**
 * ScoutLane style system, shared TypeScript types.
 *
 * The two independent style axes are Theme (color) and FontPair (typography).
 * Together they form a StyleSelection. One StyleSelection applies to ALL three
 * packet artifacts: fit assessment, resume .docx, and cover letter .docx.
 */

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

/** A color theme from lib/style/themes.json */
export interface Theme {
  id: string;
  order: number;
  master?: boolean;
  name: string;

  /** Brand color: name, headers, company names, structural elements */
  primary: string; // hex without '#'

  /**
   * Graphic accent: rules, section markers, bullet accents, gauge arc.
   * GRAPHIC ONLY, never use as text color; use accentText for text.
   * Passes 3:1 graphic contrast threshold, but NOT 4.5:1 text threshold.
   */
  accent: string; // hex without '#'

  /**
   * Text accent: dates, taglines, any accent-colored text.
   * Darkened version of accent guaranteed ≥ 4.5:1 on white (WCAG AA text).
   */
  accentText: string; // hex without '#'

  /** Muted/context text: titles, secondary labels */
  slate: string; // hex without '#'

  /**
   * Light header tint. Text on wash MUST stay dark (never reverse-out).
   * Used as name-band background in the resume header.
   */
  wash: string; // hex without '#'

  bestFor: string[];
  designer?: string;
  recruiter?: string;
}

// ---------------------------------------------------------------------------
// Font pair tokens
// ---------------------------------------------------------------------------

/** A font pairing from lib/style/fonts.json */
export interface FontPair {
  id: string;
  order: number;
  master?: boolean;
  name: string;

  /** Heading / name font, real Microsoft font name, always. */
  head: string;

  /** Body / paragraph font, real Microsoft font name, always. */
  body: string;

  character?: string;

  /** 1 (modern) … 5 (traditional) */
  formality: number;

  /** 1 (invisible) … 5 (highly distinctive) */
  distinct: number;

  /** 1 (cool/formal) … 5 (warm/approachable) */
  warmth: number;

  bestFor: string[];
}

// ---------------------------------------------------------------------------
// Style selection
// ---------------------------------------------------------------------------

/** The resolved style for a packet generation. */
export interface StyleSelection {
  theme: string; // Theme.id
  font: string;  // FontPair.id
}

/** How the style was chosen, written to generations.style.source for analytics. */
export type StyleSource = 'recommended' | 'user' | 'default';

/** Full style record persisted to generations.style */
export interface StyleRecord extends StyleSelection {
  source: StyleSource;
}

// ---------------------------------------------------------------------------
// Recommender
// ---------------------------------------------------------------------------

/**
 * Inputs to the recommender. All three come from signals the fit engine
 * already derives, do not re-infer them. Map domain/vertical labels to the
 * industry keys the recommender expects via domainToIndustry() in recommend.ts.
 */
export interface RecommendInput {
  /** Fit engine domain/vertical label (e.g. "cloud computing", "insurance") */
  domain?: string;

  /** Normalised industry key after adapter (internal recommender space) */
  industry?: string;

  /** Fit engine seniority classification */
  seniority?: Seniority;

  /** Fit engine role-type classification */
  roleType?: RoleType;
}

export type Seniority =
  | 'entry'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'director'
  | 'executive';

export type RoleType =
  | 'engineer'
  | 'engineering-manager'
  | 'devops'
  | 'cloud'
  | 'data'
  | 'security'
  | 'it-ops'
  | 'product'
  | 'design'
  | 'finance'
  | 'legal'
  | 'operations'
  | 'sales'
  | 'hr'
  | 'general';

export interface RankedTheme {
  theme: Theme;
  score: number;
}

export interface RankedFont {
  font: FontPair;
  score: number;
}

export interface RecommendResult {
  /** Best pick for this role based on industry + seniority + roleType */
  recommended: {
    theme: StyleSelection['theme'];
    font: StyleSelection['font'];
    why: string;
  };

  /** Always navy_copper + cambria_calibri, always present in the UI */
  safeDefault: StyleSelection;

  /** All 10 themes ranked best → worst (for debugging / UI ordering) */
  themeRanking: RankedTheme[];

  /** All 10 fonts ranked best → worst (for debugging / UI ordering) */
  fontRanking: RankedFont[];
}

// ---------------------------------------------------------------------------
// Assessment accent resolution
// ---------------------------------------------------------------------------

/** Result of resolveAssessmentAccent, always a valid hex string */
export interface AssessmentAccentResult {
  /** Hex color (no '#') to use for the gauge arc and brand graphics */
  color: string;

  /** Whether a collision was detected and the accent fell back to primary */
  fellBack: boolean;

  /** Which status color triggered the fallback, if any */
  collisionWith?: 'fail' | 'warn' | 'pass' | 'info';
}

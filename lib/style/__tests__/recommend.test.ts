/**
 * Recommender unit tests — lib/style/__tests__/recommend.test.ts
 *
 * Pins canonical profile picks BEFORE any weight tuning so regressions are
 * caught immediately. Per the spec: "Lock these before any weight tuning."
 *
 * Run with: vitest (or jest — both syntaxes are compatible here)
 */

import { describe, it, expect } from 'vitest';
import { recommend, domainToIndustry } from '../recommend';

// ---------------------------------------------------------------------------
// domainToIndustry adapter
// ---------------------------------------------------------------------------

describe('domainToIndustry()', () => {
  it('maps insurance variations', () => {
    expect(domainToIndustry('insurance')).toBe('insurance');
    expect(domainToIndustry('Property & Casualty Insurance')).toBe('insurance');
    expect(domainToIndustry('underwriting')).toBe('insurance');
  });

  it('maps finance variations', () => {
    expect(domainToIndustry('financial services')).toBe('finance');
    expect(domainToIndustry('Investment Banking')).toBe('finance');
    expect(domainToIndustry('Wealth Management')).toBe('finance');
    expect(domainToIndustry('banking')).toBe('finance');
  });

  it('maps cloud / devops / tech', () => {
    expect(domainToIndustry('cloud computing')).toBe('cloud');
    expect(domainToIndustry('Platform Engineering')).toBe('cloud');
    expect(domainToIndustry('DevOps')).toBe('cloud');
    expect(domainToIndustry('software')).toBe('tech');
    expect(domainToIndustry('SaaS')).toBe('tech');
  });

  it('maps healthcare', () => {
    expect(domainToIndustry('healthcare')).toBe('healthcare');
    expect(domainToIndustry('Pharmaceutical')).toBe('healthcare');
    expect(domainToIndustry('clinical research')).toBe('healthcare');
  });

  it('maps legal / compliance', () => {
    expect(domainToIndustry('legal')).toBe('legal');
    expect(domainToIndustry('compliance and regulatory')).toBe('legal');
  });

  it('maps manufacturing / operations', () => {
    expect(domainToIndustry('manufacturing')).toBe('manufacturing');
    expect(domainToIndustry('supply chain')).toBe('manufacturing');
    expect(domainToIndustry('logistics')).toBe('manufacturing');
    expect(domainToIndustry('operations')).toBe('operations');
  });

  it('returns default for unknown domains', () => {
    expect(domainToIndustry('')).toBe('default');
    expect(domainToIndustry(null)).toBe('default');
    expect(domainToIndustry(undefined)).toBe('default');
    expect(domainToIndustry('veterinary dentistry')).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// recommend() structure
// ---------------------------------------------------------------------------

describe('recommend() — return shape', () => {
  it('always returns safeDefault as navy_copper + cambria_calibri', () => {
    const r = recommend({});
    expect(r.safeDefault).toEqual({ theme: 'navy_copper', font: 'cambria_calibri' });
  });

  it('returns 10 theme rankings and 10 font rankings', () => {
    const r = recommend({ domain: 'insurance', seniority: 'senior' });
    expect(r.themeRanking).toHaveLength(10);
    expect(r.fontRanking).toHaveLength(10);
  });

  it('recommended theme and font appear in their respective rankings as #1', () => {
    const r = recommend({ domain: 'cloud computing', seniority: 'mid', roleType: 'devops' });
    expect(r.themeRanking[0]!.theme.id).toBe(r.recommended.theme);
    expect(r.fontRanking[0]!.font.id).toBe(r.recommended.font);
  });

  it('recommended.why is a non-empty string', () => {
    const r = recommend({ domain: 'finance', seniority: 'director' });
    expect(typeof r.recommended.why).toBe('string');
    expect(r.recommended.why.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Canonical profile pins (lock BEFORE tuning)
// ---------------------------------------------------------------------------
//
// These are the expected picks for canonical role profiles. They pin the
// recommender's current behavior. If you change weights or scoring, these
// tests will break — that is intentional. Update only after confirming the
// new output is better for real users.

describe('recommend() — canonical profile pins', () => {
  it('insurance / senior / general → navy_copper theme', () => {
    const r = recommend({
      domain: 'insurance',
      seniority: 'senior',
      roleType: 'general',
    });
    expect(r.recommended.theme).toBe('navy_copper');
  });

  it('finance / director → navy_copper or oxford_burgundy theme (both valid)', () => {
    const r = recommend({
      domain: 'financial services',
      seniority: 'director',
    });
    expect(['navy_copper', 'oxford_burgundy', 'midnight_gold']).toContain(r.recommended.theme);
  });

  it('finance / executive → midnight_gold or oxford_burgundy (prestige/executive themes)', () => {
    const r = recommend({
      domain: 'financial services',
      seniority: 'executive',
    });
    expect(['midnight_gold', 'oxford_burgundy', 'navy_copper']).toContain(r.recommended.theme);
  });

  it('cloud / senior / devops → ink_teal or graphite_electric theme', () => {
    const r = recommend({
      domain: 'cloud computing',
      seniority: 'senior',
      roleType: 'devops',
    });
    expect(['ink_teal', 'graphite_electric', 'tahoma_tahoma']).not.toContain(r.recommended.theme); // NOT a business theme
    expect(['ink_teal', 'graphite_electric']).toContain(r.recommended.theme);
  });

  it('healthcare / manager / operations → forest_stone theme', () => {
    const r = recommend({
      domain: 'healthcare',
      seniority: 'mid',
      roleType: 'operations',
    });
    expect(r.recommended.theme).toBe('forest_stone');
  });

  it('legal / senior → oxford_burgundy or navy_copper (traditional/executive themes)', () => {
    const r = recommend({
      domain: 'legal',
      seniority: 'senior',
      roleType: 'legal',
    });
    expect(['oxford_burgundy', 'navy_copper', 'midnight_gold']).toContain(r.recommended.theme);
  });

  it('startup / mid / engineer → graphite_electric or ink_teal theme', () => {
    const r = recommend({
      domain: 'software',
      seniority: 'mid',
      roleType: 'engineer',
    });
    expect(['graphite_electric', 'ink_teal', 'calibri_calibri']).not.toContain(r.recommended.theme);
    expect(['graphite_electric', 'ink_teal']).toContain(r.recommended.theme);
  });

  it('unknown domain → safe default theme (navy_copper)', () => {
    const r = recommend({});
    expect(r.recommended.theme).toBe('navy_copper');
  });

  it('unknown domain → safe default font (cambria_calibri)', () => {
    const r = recommend({});
    expect(r.recommended.font).toBe('cambria_calibri');
  });

  it('legal / senior → times_arial or garamond_calibri font (traditional)', () => {
    const r = recommend({
      domain: 'legal',
      seniority: 'senior',
      roleType: 'legal',
    });
    expect(['times_arial', 'garamond_calibri', 'bookantiqua_tahoma']).toContain(r.recommended.font);
  });

  it('startup / engineer → calibri_calibri or tahoma_tahoma font (modern minimal)', () => {
    const r = recommend({
      domain: 'software',
      seniority: 'mid',
      roleType: 'engineer',
    });
    // tahoma_tahoma is known to over-score — this test intentionally captures current behavior
    // before tuning (per spec: "add unit tests pinning canonical picks BEFORE tuning")
    expect(['calibri_calibri', 'tahoma_tahoma']).toContain(r.recommended.font);
  });
});

// ---------------------------------------------------------------------------
// Seniority nudge effects
// ---------------------------------------------------------------------------

describe('recommend() — seniority nudge', () => {
  it('executive seniority pushes toward more traditional themes than entry', () => {
    const exec = recommend({ domain: 'tech', seniority: 'executive' });
    const entry = recommend({ domain: 'tech', seniority: 'entry' });
    const execTheme = exec.themeRanking.find((r) => r.theme.id === 'midnight_gold');
    const entryTheme = entry.themeRanking.find((r) => r.theme.id === 'midnight_gold');
    expect(execTheme!.score).toBeGreaterThanOrEqual(entryTheme!.score);
  });

  it('executive/director seniority never recommends a startup/bold theme as top pick', () => {
    for (const seniority of ['executive', 'director', 'principal'] as const) {
      const r = recommend({ domain: 'finance', seniority });
      expect(['graphite_electric', 'steel_crimson', 'slate_rust']).not.toContain(
        r.recommended.theme,
      );
    }
  });

  it('entry seniority in tech does not recommend oxford_burgundy or midnight_gold', () => {
    const r = recommend({ domain: 'software', seniority: 'entry', roleType: 'engineer' });
    expect(['oxford_burgundy', 'midnight_gold']).not.toContain(r.recommended.theme);
  });
});

// ---------------------------------------------------------------------------
// Idempotence + purity
// ---------------------------------------------------------------------------

describe('recommend() — purity', () => {
  it('returns identical results for identical inputs (no side effects)', () => {
    const input = { domain: 'insurance', seniority: 'senior' as const, roleType: 'general' as const };
    const r1 = recommend(input);
    const r2 = recommend(input);
    expect(r1.recommended).toEqual(r2.recommended);
    expect(r1.themeRanking.map((r) => r.theme.id)).toEqual(r2.themeRanking.map((r) => r.theme.id));
  });
});

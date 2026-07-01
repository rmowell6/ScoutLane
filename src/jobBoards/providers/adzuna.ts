// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane, Adzuna Provider
// Docs: https://developer.adzuna.com/
// Auth: free API key, register at https://developer.adzuna.com/signup
// Coverage: US + 12 other countries, 20M+ jobs
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  AdzunaConfig,
} from '../types';
import {
  fetchJSON,
  buildId,
  mapEach,
  normaliseJobType,
  parseSalaryString,
  safeDate,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// Adzuna API response types
// ---------------------------------------------------------------------------

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  created: string;           // ISO 8601
  redirect_url: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_type?: string;
  contract_time?: string;
  location: { display_name: string; area: string[] };
  company: { display_name: string };
  category: { label: string; tag: string };
  adref?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: AdzunaJob, source: string): Job {
  const salary =
    raw.salary_min || raw.salary_max
      ? {
          min: raw.salary_min,
          max: raw.salary_max,
          currency: 'USD',
          period: 'annual' as const,
        }
      : undefined;

  // Guard nested objects, a row missing company/location/category must not throw (mapEach would
  // skip it, but optional-chaining keeps the common partial row usable).
  const locationName = raw.location?.display_name ?? '';
  const title = raw.title ?? '';

  return {
    id: buildId(source, raw.id),
    source,
    title,
    company: raw.company?.display_name ?? 'Unknown',
    location: locationName,
    remote:
      locationName.toLowerCase().includes('remote') || title.toLowerCase().includes('remote'),
    type: normaliseJobType(raw.contract_type ?? raw.contract_time),
    salary,
    description: raw.description ?? '',
    tags: raw.category?.tag ? [raw.category.tag] : [],
    url: raw.redirect_url,
    postedAt: safeDate(raw.created),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AdzunaProvider implements JobBoardProvider {
  readonly name = 'adzuna';

  constructor(private readonly config: AdzunaConfig) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const country = params.country ?? this.config.country ?? 'us';
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    const qs = new URLSearchParams({
      app_id: this.config.appId,
      app_key: this.config.appKey,
      results_per_page: String(pageSize),
      'content-type': 'application/json',
    });

    if (params.query) qs.set('what', params.query);
    if (params.location) qs.set('where', params.location);
    if (params.salaryMin) qs.set('salary_min', String(params.salaryMin));
    if (params.remote) qs.set('where', 'remote');
    if (params.type === 'contract') qs.set('contract_type', 'contract');
    if (params.type === 'part-time') qs.set('contract_time', 'part_time');
    if (params.tags?.length) qs.set('what_and', params.tags.join(' '));

    // Default to IT/tech category
    qs.set('category', 'it-jobs');

    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${qs}`;

    try {
      const data = await fetchJSON<AdzunaResponse>(url, {}, this.config.timeoutMs);
      return {
        jobs: mapEach(data.results, (j) => mapJob(j, this.name)),
        total: data.count,
        page,
        pageSize,
        source: this.name,
      };
    } catch (err) {
      return {
        jobs: [],
        total: 0,
        page,
        pageSize,
        source: this.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

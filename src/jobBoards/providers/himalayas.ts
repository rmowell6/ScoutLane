// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Himalayas Provider
// Docs: https://himalayas.app/api
// Auth: None — fully public
// Coverage: Remote tech/IT roles globally
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  ProviderConfig,
} from '../types';
import {
  fetchJSON,
  buildId,
  normaliseJobType,
  parseSalaryString,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// Himalayas API response types
// ---------------------------------------------------------------------------

interface HimalayasResponse {
  jobs: HimalayasJob[];
  meta: { total: number; page: number; limit: number };
}

interface HimalayasJob {
  slug: string;
  title: string;
  companyName: string;
  companyLogo?: string;
  locationRestrictions: string[];
  jobType?: string;
  salaryRange?: string;
  description: string;
  categories: string[];
  applicationUrl?: string;
  url: string;
  createdAt: string;   // ISO 8601
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(raw: HimalayasJob, source: string): Job {
  const location =
    raw.locationRestrictions.length > 0
      ? raw.locationRestrictions.join(', ')
      : 'Remote';

  return {
    id: buildId(source, raw.slug),
    source,
    title: raw.title,
    company: raw.companyName,
    companyLogo: raw.companyLogo,
    location,
    remote: true,  // Himalayas is remote-only
    type: normaliseJobType(raw.jobType),
    salary: parseSalaryString(raw.salaryRange),
    description: raw.description,
    tags: raw.categories,
    url: raw.url,
    applyUrl: raw.applicationUrl,
    postedAt: new Date(raw.createdAt),
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class HimalayasProvider implements JobBoardProvider {
  readonly name = 'himalayas';

  constructor(private readonly config: ProviderConfig = {}) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    const qs = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });

    if (params.query) qs.set('q', params.query);
    if (params.tags?.length) qs.set('categories', params.tags.join(','));
    if (params.type) qs.set('jobType', params.type);
    if (params.location) qs.set('locationRestrictions', params.location);

    const url = `https://himalayas.app/api/jobs?${qs}`;

    try {
      const data = await fetchJSON<HimalayasResponse>(url, {}, this.config.timeoutMs);
      return {
        jobs: data.jobs.map((j) => mapJob(j, this.name)),
        total: data.meta.total,
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

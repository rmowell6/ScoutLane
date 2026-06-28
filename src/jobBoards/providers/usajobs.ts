// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — USAJobs Provider
// Docs: https://developer.usajobs.gov/
// Auth: Free API key — register at https://developer.usajobs.gov/api-reference/
// Coverage: All US federal government IT/tech jobs
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Job,
  JobBoardProvider,
  JobSearchResult,
  SearchParams,
  USAJobsConfig,
} from '../types';
import {
  fetchJSON,
  buildId,
  normaliseJobType,
  DEFAULT_PAGE_SIZE,
} from './base';

// ---------------------------------------------------------------------------
// USAJobs API response types
// ---------------------------------------------------------------------------

interface USAJobsResponse {
  LanguageCode: string;
  SearchParameters: Record<string, unknown>;
  SearchResult: {
    SearchResultCount: number;
    SearchResultCountAll: number;
    SearchResultItems: USAJobsItem[];
  };
}

interface USAJobsItem {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionID: string;
    PositionTitle: string;
    PositionURI: string;
    ApplyURI: string[];
    PositionLocationDisplay: string;
    PositionLocation: Array<{ LocationName: string; CountryCode: string }>;
    OrganizationName: string;
    DepartmentName: string;
    JobCategory: Array<{ Code: string; Name: string }>;
    JobGrade: Array<{ Code: string }>;
    PositionSchedule: Array<{ Code: string; Name: string }>;
    PositionOfferingType: Array<{ Code: string; Name: string }>;
    QualificationSummary: string;
    PositionRemuneration: Array<{
      MinimumRange: string;
      MaximumRange: string;
      RateIntervalCode: string;
    }>;
    PublicationStartDate: string;
    ApplicationCloseDate: string;
    UserArea: {
      Details: {
        JobSummary: string;
        TotalOpenings: string;
        WhoMayApply: { Name: string };
        SubAgencyName: string;
        MajorDuties: string[];
        Education: string;
        Requirements: string;
        Evaluations: string;
        HowToApply: string;
        RemoteIndicator: boolean;
      };
    };
  };
}

// Interval code → period
const RATE_INTERVAL: Record<string, 'hourly' | 'annual'> = {
  PA: 'annual',
  PH: 'hourly',
  WC: 'annual',
};

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapJob(item: USAJobsItem, source: string): Job {
  const d = item.MatchedObjectDescriptor;
  const remun = d.PositionRemuneration?.[0];
  const details = d.UserArea?.Details;

  const salary = remun
    ? {
        min: parseFloat(remun.MinimumRange),
        max: parseFloat(remun.MaximumRange),
        currency: 'USD',
        period: RATE_INTERVAL[remun.RateIntervalCode] ?? 'annual',
      }
    : undefined;

  const jobType = normaliseJobType(d.PositionSchedule?.[0]?.Name);

  const tags = [
    ...d.JobCategory.map((c) => c.Name),
    ...d.JobGrade.map((g) => g.Code),
  ].filter(Boolean);

  return {
    id: buildId(source, d.PositionID),
    source,
    title: d.PositionTitle,
    company: d.DepartmentName || d.OrganizationName,
    location: d.PositionLocationDisplay,
    remote: details?.RemoteIndicator ?? false,
    type: jobType,
    salary,
    description: details?.JobSummary || d.QualificationSummary || '',
    tags,
    url: d.PositionURI,
    applyUrl: d.ApplyURI?.[0],
    postedAt: new Date(d.PublicationStartDate),
    expiresAt: d.ApplicationCloseDate ? new Date(d.ApplicationCloseDate) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class USAJobsProvider implements JobBoardProvider {
  readonly name = 'usajobs';

  constructor(private readonly config: USAJobsConfig) {}

  async search(params: SearchParams): Promise<JobSearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

    const qs = new URLSearchParams({
      ResultsPerPage: String(pageSize),
      Page: String(page),
      // Default to IT/CS occupational series
      JobCategoryCode: '2210',   // Information Technology Management
    });

    if (params.query) qs.set('Keyword', params.query);
    if (params.location) qs.set('LocationName', params.location);
    if (params.remote) qs.set('RemoteIndicator', 'true');
    if (params.salaryMin) qs.set('RemunerationMinimumAmount', String(params.salaryMin));

    const url = `https://data.usajobs.gov/api/search?${qs}`;

    try {
      const data = await fetchJSON<USAJobsResponse>(
        url,
        {
          headers: {
            'Authorization-Key': this.config.apiKey,
            'User-Agent': this.config.userAgent,
            Host: 'data.usajobs.gov',
          },
        },
        this.config.timeoutMs,
      );

      const sr = data.SearchResult;
      return {
        jobs: sr.SearchResultItems.map((i) => mapJob(i, this.name)),
        total: sr.SearchResultCountAll,
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

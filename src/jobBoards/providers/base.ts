// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Base provider helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { JobType, Salary } from '../types';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Wraps fetch with a timeout. Throws on non-2xx responses.
 */
export async function fetchJSON<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

/** Safely parse a salary string like "$80k–$120k" or "80000-120000". */
export function parseSalaryString(raw: string | null | undefined): Salary | undefined {
  if (!raw) return undefined;

  // Extract numbers
  const nums = raw.replace(/[,$k]/gi, (m) => (m.toLowerCase() === 'k' ? '000' : '')).match(/\d+/g);
  if (!nums || nums.length === 0) return undefined;

  const values = nums.map(Number).filter((n) => n > 0);
  if (values.length === 0) return undefined;

  const currency = raw.includes('£') ? 'GBP' : raw.includes('€') ? 'EUR' : 'USD';

  return {
    min: values[0],
    max: values[1] ?? undefined,
    currency,
    period: 'annual',
  };
}

/** Normalise employment type strings from various providers. */
export function normaliseJobType(raw: string | null | undefined): JobType {
  if (!raw) return 'full-time';
  const lower = raw.toLowerCase().replace(/[_\s-]/g, '');
  if (lower.includes('part')) return 'part-time';
  if (lower.includes('contract') || lower.includes('freelance')) return 'contract';
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('freelance')) return 'freelance';
  return 'full-time';
}

/** Strip HTML tags from a description. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Build a deterministic provider-scoped ID. */
export function buildId(source: string, externalId: string | number): string {
  return `${source}:${externalId}`;
}

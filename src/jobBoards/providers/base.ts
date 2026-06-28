// @ts-nocheck -- vendored job-board module (kept as delivered; integration code is strict)
// ─────────────────────────────────────────────────────────────────────────────
// ScoutLane — Base provider helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { Job, JobType, Salary } from '../types';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_PAGE_SIZE = 25;
// Largest provider response we'll buffer. A whole-feed board (e.g. RemoteOK returns ALL jobs) is a
// few MB; 25 MB is a generous ceiling that still stops a hostile/misbehaving endpoint from
// exhausting memory on the ingest worker. Mirrors lib/services/ats/fetchJson.ts.
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Wraps fetch with a timeout AND a response-size cap. Throws on non-2xx. The body is streamed and
 * aborted the moment it exceeds the byte cap, so a bogus/absent Content-Length can't sneak an
 * oversized payload past us.
 */
export async function fetchJSON<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    // Reject early on an advertised oversize body; then enforce as we read in case the header lies.
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response too large (${declared} bytes > ${maxBytes}) — ${url}`);
    }
    return (await readCapped(res, maxBytes, url)) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Read+parse a response as JSON, aborting if it exceeds maxBytes. Streams when a readable body is
 *  available; falls back to text()/json() for runtimes or test shims that don't expose one. */
async function readCapped(res: Response, maxBytes: number, url: string): Promise<unknown> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    if (typeof res.text === 'function') {
      const text = await res.text();
      if (text.length > maxBytes) throw new Error(`response too large (>${maxBytes} bytes) — ${url}`);
      return JSON.parse(text);
    }
    return res.json();
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response too large (>${maxBytes} bytes) — ${url}`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return JSON.parse(out);
}

/**
 * Parse a provider date defensively. An unparseable/absent value yields `new Date(fallback)` (the
 * current time by default) instead of an Invalid Date whose NaN getTime() poisons the newest-first
 * sort and the dedup "keep newer" tie-break.
 */
export function safeDate(raw: unknown, fallback: number = Date.now()): Date {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? new Date(fallback) : raw;
  const d = new Date(raw as string);
  return Number.isNaN(d.getTime()) ? new Date(fallback) : d;
}

/**
 * Map each provider row to a Job, isolating per-row failures: a single malformed row (a missing
 * nested object, a bad shape) is skipped rather than throwing and dropping the provider's ENTIRE
 * batch. Downstream isStorableJob already discards url/title-less rows, so skipping is safe.
 */
export function mapEach<R>(items: R[] | null | undefined, fn: (item: R) => Job): Job[] {
  const out: Job[] = [];
  for (const item of items ?? []) {
    try {
      out.push(fn(item));
    } catch {
      // skip the bad row; the rest of the batch survives
    }
  }
  return out;
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

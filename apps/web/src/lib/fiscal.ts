// Zuora fiscal year starts in February.
// FY{N} = Feb of (N-1) → Jan of N. e.g. FY27 = Feb 2026 → Jan 2027.
// Q1 = Feb-Apr, Q2 = May-Jul, Q3 = Aug-Oct, Q4 = Nov-Jan.

import {
  enumerateFiscalQuarterKeys,
  fiscalQuarterEnd,
  parseFiscalQuarterKey,
} from '@mdas/renewal-metrics';

/** Earliest fiscal quarter in the standard MDAS reporting window (Expand 3 FY26 book). */
export const FISCAL_HISTORY_START_KEY = '2026-Q1';

/**
 * Rolling data-pull / close-date horizon: current quarter + this many future
 * quarters. Used for the SFDC pull window and opportunity close-date ranges.
 * NOT the selectable prospective filter window (see FISCAL_QUARTER_PROSPECTIVE_COUNT).
 */
export const FISCAL_QUARTER_FORWARD_COUNT = 8;

/**
 * Selectable prospective filter bucket: this many quarters TOTAL, starting at
 * (and including) the current quarter. So current + next 7. The current quarter
 * is prospective-only — it never appears in the retrospective bucket.
 */
export const FISCAL_QUARTER_PROSPECTIVE_COUNT = 8;

/** Rolling retrospective window: this many fully ended quarters. */
export const FISCAL_QUARTER_RETROSPECTIVE_COUNT = 8;

export interface FiscalQuarter {
  fy: number;
  q: 1 | 2 | 3 | 4;
  /** Sortable key, e.g. "2027-Q1" */
  key: string;
  /** Display label, e.g. "FY27 Q1" */
  label: string;
}

export function fiscalQuarterFromDate(iso: string | null | undefined): FiscalQuarter | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1; // 1-12
  const year = d.getUTCFullYear();
  let fy: number;
  let q: 1 | 2 | 3 | 4;
  if (month === 1) {
    fy = year;
    q = 4;
  } else if (month <= 4) {
    fy = year + 1;
    q = 1;
  } else if (month <= 7) {
    fy = year + 1;
    q = 2;
  } else if (month <= 10) {
    fy = year + 1;
    q = 3;
  } else {
    fy = year + 1;
    q = 4;
  }
  return {
    fy,
    q,
    key: `${fy}-Q${q}`,
    label: `FY${String(fy).slice(-2)} Q${q}`,
  };
}

export function fiscalQuarterKey(fy: number, q: number): string {
  return `${fy}-Q${q}`;
}

/** The fiscal quarter immediately before `currentKey`. */
export function previousFiscalQuarterKey(currentKey: string): string | null {
  const m = currentKey.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  if (q === 1) return fiscalQuarterKey(fy - 1, 4);
  return fiscalQuarterKey(fy, q - 1);
}

/** The fiscal quarter immediately after `currentKey` (e.g. `2027-Q2` → `2027-Q3`, `2027-Q4` → `2028-Q1`). */
export function nextFiscalQuarterKey(currentKey: string): string | null {
  const m = currentKey.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  if (q === 4) return fiscalQuarterKey(fy + 1, 1);
  return fiscalQuarterKey(fy, q + 1);
}

/** UTC ISO date of the first day of a Zuora fiscal quarter (for anchoring forecast buckets). */
export function fiscalQuarterStartIso(key: string): string {
  const m = key.match(/^(\d+)-Q([1-4])$/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10) as 1 | 2 | 3 | 4;
  const monthByQ: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 };
  const year = fy - 1;
  return new Date(Date.UTC(year, monthByQ[q]!, 1)).toISOString().slice(0, 10);
}

export function fiscalQuarterLabel(key: string): string {
  if (!/^\d{4}-Q[1-4]$/.test(key)) return '';
  const [fy, q] = key.split('-');
  return `FY${(fy ?? '').slice(-2)} ${q ?? ''}`;
}

/** Join valid quarter keys into a display label (skips sentinels and malformed keys). */
export function formatQuarterSelectionLabel(keys: Iterable<string>): string {
  return [...keys]
    .map(fiscalQuarterLabel)
    .filter(Boolean)
    .join(', ');
}

/**
 * Last `count` fiscal quarter keys ending at `endKey` (inclusive), oldest first.
 * Used for retention trend charts capped at 8 quarters.
 */
export function fiscalQuarterKeysTrailing(
  count: number,
  endKey: string,
): string[] {
  const keys: string[] = [endKey];
  let key = endKey;
  for (let i = 1; i < count; i++) {
    const prev = previousFiscalQuarterKey(key);
    if (!prev) break;
    keys.unshift(prev);
    key = prev;
  }
  return keys;
}

/**
 * Today's fiscal quarter — the global default for every filter.
 * Pure function so it's safe to call on the server.
 */
export function currentFiscalQuarter(): FiscalQuarter {
  // Always returns a quarter (Date.now is well-defined). The non-null
  // assertion is the simplest way to satisfy the type checker without
  // an unnecessary fallback that would never execute.
  return fiscalQuarterFromDate(new Date().toISOString())!;
}

/**
 * Earliest quarter key for filters and close-date windows.
 * Uses the oldest quarter present in `dataQuarterKeys` when earlier than
 * {@link FISCAL_HISTORY_START_KEY} so historical snapshot data stays selectable.
 */
export function effectiveFiscalHistoryStartKey(dataQuarterKeys: string[] = []): string {
  let start = FISCAL_HISTORY_START_KEY;
  for (const key of dataQuarterKeys) {
    if (/^\d{4}-Q[1-4]$/.test(key) && key < start) start = key;
  }
  return start;
}

/** Last fully ended fiscal quarter (day before current quarter starts). */
export function fiscalQuarterRetrospectiveEndKey(anchor: Date = new Date()): string {
  const current = fiscalQuarterFromDate(anchor.toISOString())!.key;
  return previousFiscalQuarterKey(current) ?? current;
}

/** First key in the retrospective window (end minus count-1 quarters). */
export function fiscalQuarterRetrospectiveStartKey(
  count = FISCAL_QUARTER_RETROSPECTIVE_COUNT,
  anchor: Date = new Date(),
): string {
  let key = fiscalQuarterRetrospectiveEndKey(anchor);
  for (let i = 1; i < count; i++) {
    const prev = previousFiscalQuarterKey(key);
    if (!prev) break;
    key = prev;
  }
  return key;
}

/** First key in the prospective window (today's quarter). */
export function fiscalQuarterProspectiveStartKey(anchor: Date = new Date()): string {
  return fiscalQuarterFromDate(anchor.toISOString())!.key;
}

/**
 * Last key in the prospective window. `count` is the TOTAL number of quarters
 * including the current one, so the end is current + (count - 1).
 */
export function fiscalQuarterProspectiveEndKey(
  count = FISCAL_QUARTER_PROSPECTIVE_COUNT,
  anchor: Date = new Date(),
): string {
  let key = fiscalQuarterProspectiveStartKey(anchor);
  for (let i = 1; i < count; i++) {
    const next = nextFiscalQuarterKey(key);
    if (!next) break;
    key = next;
  }
  return key;
}

export type FiscalQuarterBucket = 'prospective' | 'retrospective';

/** Quarters in the prospective bucket: current + next 7 (8 total). */
export function fiscalQuarterProspectiveOptions(
  opts: FiscalQuarterWindowOpts & { prospectiveCount?: number } = {},
): FiscalQuarter[] {
  const anchor = opts.anchor ?? new Date();
  const startKey = fiscalQuarterProspectiveStartKey(anchor);
  const endKey = fiscalQuarterProspectiveEndKey(
    opts.prospectiveCount ?? FISCAL_QUARTER_PROSPECTIVE_COUNT,
    anchor,
  );
  return enumerateFiscalQuarterKeys(startKey, endKey)
    .map((key) => parseFiscalQuarterKey(key))
    .filter((fq): fq is FiscalQuarter => fq != null);
}

/** Quarters in the retrospective bucket: last 8 fully ended quarters. */
export function fiscalQuarterRetrospectiveOptions(
  opts: FiscalQuarterWindowOpts & { retrospectiveCount?: number } = {},
): FiscalQuarter[] {
  const anchor = opts.anchor ?? new Date();
  const startKey = fiscalQuarterRetrospectiveStartKey(
    opts.retrospectiveCount ?? FISCAL_QUARTER_RETROSPECTIVE_COUNT,
    anchor,
  );
  const endKey = fiscalQuarterRetrospectiveEndKey(anchor);
  return enumerateFiscalQuarterKeys(startKey, endKey)
    .map((key) => parseFiscalQuarterKey(key))
    .filter((fq): fq is FiscalQuarter => fq != null);
}

export function fiscalQuarterOptionsForBucket(
  bucket: FiscalQuarterBucket,
  opts: FiscalQuarterWindowOpts = {},
): FiscalQuarter[] {
  return bucket === 'prospective'
    ? fiscalQuarterProspectiveOptions(opts)
    : fiscalQuarterRetrospectiveOptions(opts);
}

/** Default single-quarter selection when entering a bucket. */
export function defaultFiscalQuarterForBucket(
  bucket: FiscalQuarterBucket,
  anchor: Date = new Date(),
): string {
  return bucket === 'prospective'
    ? fiscalQuarterProspectiveStartKey(anchor)
    : fiscalQuarterRetrospectiveEndKey(anchor);
}

/** Keep only quarters valid for the bucket; fall back to bucket default. */
export function effectiveQuartersForBucket(
  parsed: Set<string> | null,
  bucket: FiscalQuarterBucket,
  anchor: Date = new Date(),
): Set<string> {
  const allowed = fiscalQuarterOptionsForBucket(bucket, { anchor }).map((o) => o.key);
  const allowedSet = new Set(allowed);
  if (!parsed || parsed.size === 0) {
    return new Set([defaultFiscalQuarterForBucket(bucket, anchor)]);
  }
  const filtered = [...parsed].filter((k) => allowedSet.has(k));
  if (filtered.length === 0) {
    return new Set([defaultFiscalQuarterForBucket(bucket, anchor)]);
  }
  return new Set(filtered);
}

export function isProspectiveQuarterKey(
  quarterKey: string,
  anchor: Date = new Date(),
): boolean {
  const start = fiscalQuarterProspectiveStartKey(anchor);
  const end = fiscalQuarterProspectiveEndKey(
    FISCAL_QUARTER_PROSPECTIVE_COUNT,
    anchor,
  );
  return quarterKey >= start && quarterKey <= end;
}

export function isRetrospectiveQuarterKey(
  quarterKey: string,
  anchor: Date = new Date(),
): boolean {
  const start = fiscalQuarterRetrospectiveStartKey(
    FISCAL_QUARTER_RETROSPECTIVE_COUNT,
    anchor,
  );
  const end = fiscalQuarterRetrospectiveEndKey(anchor);
  return quarterKey >= start && quarterKey <= end;
}

/** The 8 quarter keys that make up a bucket (used for the "all in bucket" case). */
export function bucketQuarterKeys(
  bucket: FiscalQuarterBucket,
  anchor: Date = new Date(),
): string[] {
  return fiscalQuarterOptionsForBucket(bucket, { anchor }).map((o) => o.key);
}

/** Parse the `?bucket=` URL param, falling back to a per-page default. */
export function resolveQuarterBucket(
  raw: string | null | undefined,
  defaultBucket: FiscalQuarterBucket = 'prospective',
): FiscalQuarterBucket {
  if (raw === 'prospective' || raw === 'retrospective') return raw;
  return defaultBucket;
}

/**
 * Effective quarter keys to filter page data by, scoped to the active bucket.
 *   - null / empty selection  -> all quarters in the bucket (never all-time)
 *   - explicit selection      -> intersected with the bucket (no past/future mix)
 *   - "__none__" sentinel      -> preserved, so an empty selection yields 0 rows
 */
export function scopeQuartersToBucket(
  parsed: Set<string> | null,
  bucket: FiscalQuarterBucket,
  anchor: Date = new Date(),
): Set<string> {
  const keys = bucketQuarterKeys(bucket, anchor);
  if (!parsed) return new Set(keys);
  if (parsed.has('__none__')) return new Set();
  const allowed = new Set(keys);
  const filtered = [...parsed].filter((k) => allowed.has(k) && /^\d{4}-Q[1-4]$/.test(k));
  return filtered.length > 0 ? new Set(filtered) : new Set(keys);
}

/** Last fiscal quarter key in the rolling window (current + `forwardCount` future quarters). */
export function fiscalQuarterWindowEndKey(
  forwardCount = FISCAL_QUARTER_FORWARD_COUNT,
  anchor: Date = new Date(),
): string {
  let key = fiscalQuarterFromDate(anchor.toISOString())!.key;
  for (let i = 0; i < forwardCount; i++) {
    const next = nextFiscalQuarterKey(key);
    if (!next) break;
    key = next;
  }
  return key;
}

export interface FiscalQuarterWindowOpts {
  /** Quarters with data on the current page — may extend the history start backward. */
  dataQuarterKeys?: string[];
  forwardCount?: number;
  anchor?: Date;
}

/**
 * Canonical fiscal quarter option list: all history through current + 8 future
 * quarters (rolling). Used by FiscalQuarterFilter, Forecast, and renewal trends.
 */
export function fiscalQuarterFilterOptions(opts: FiscalQuarterWindowOpts = {}): FiscalQuarter[] {
  const anchor = opts.anchor ?? new Date();
  const startKey = effectiveFiscalHistoryStartKey(opts.dataQuarterKeys ?? []);
  const endKey = fiscalQuarterWindowEndKey(opts.forwardCount ?? FISCAL_QUARTER_FORWARD_COUNT, anchor);
  return enumerateFiscalQuarterKeys(startKey, endKey)
    .map((key) => parseFiscalQuarterKey(key))
    .filter((fq): fq is FiscalQuarter => fq != null);
}

/** Inclusive close-date window for opportunity lists (history start → end of forward horizon). */
export function fiscalOpportunityCloseDateRange(opts: FiscalQuarterWindowOpts = {}): {
  min: string;
  max: string;
} {
  const anchor = opts.anchor ?? new Date();
  const startKey = effectiveFiscalHistoryStartKey(opts.dataQuarterKeys ?? []);
  const endKey = fiscalQuarterWindowEndKey(opts.forwardCount ?? FISCAL_QUARTER_FORWARD_COUNT, anchor);
  const endFq = parseFiscalQuarterKey(endKey);
  return {
    min: fiscalQuarterStartIso(startKey),
    max: endFq ? fiscalQuarterEnd(endFq) : anchor.toISOString().slice(0, 10),
  };
}

/** Fiscal years touched by the rolling quarter window (for CTA / engine scope). */
export function fiscalYearsInWindow(opts: FiscalQuarterWindowOpts = {}): number[] {
  const keys = fiscalQuarterFilterOptions(opts).map((fq) => fq.fy);
  return [...new Set(keys)].sort((a, b) => a - b);
}

/**
 * @deprecated Prefer {@link fiscalQuarterFilterOptions}. Kept for explicit trailing/forward overrides.
 */
export function rollingFiscalQuarters(
  trailing = 4,
  forward = 4,
  anchor: Date = new Date(),
): FiscalQuarter[] {
  const out: FiscalQuarter[] = [];
  for (let i = -trailing; i <= forward; i++) {
    const d = new Date(anchor);
    d.setUTCMonth(d.getUTCMonth() + i * 3);
    const fq = fiscalQuarterFromDate(d.toISOString());
    if (fq && !out.some((x) => x.key === fq.key)) out.push(fq);
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Account → list of fiscal quarter keys it touches. Centralized so every
 * page applies identical bucketing semantics:
 *   - Confirmed Churn → account.churnDate
 *   - Otherwise → union of opportunity.closeDate
 */
export function fiscalQuartersForAccount(v: {
  bucket: string;
  account: { churnDate?: string | null };
  opportunities: { closeDate?: string | null }[];
}): string[] {
  if (v.bucket === 'Confirmed Churn') {
    const fq = fiscalQuarterFromDate(v.account.churnDate);
    return fq ? [fq.key] : [];
  }
  const keys = new Set<string>();
  for (const o of v.opportunities) {
    const fq = fiscalQuarterFromDate(o.closeDate);
    if (fq) keys.add(fq.key);
  }
  return Array.from(keys);
}

/** Parse the `?quarters=` URL param into a Set. Empty / null → null (== all). */
export function parseQuartersParam(raw: string | undefined | null): Set<string> | null {
  if (!raw) return null;
  const set = new Set(raw.split(',').filter(Boolean));
  return set.size === 0 ? null : set;
}

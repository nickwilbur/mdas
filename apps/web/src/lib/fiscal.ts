// Zuora fiscal year starts in February.
// FY{N} = Feb of (N-1) → Jan of N. e.g. FY27 = Feb 2026 → Jan 2027.
// Q1 = Feb-Apr, Q2 = May-Jul, Q3 = Aug-Oct, Q4 = Nov-Jan.

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

export function fiscalQuarterLabel(key: string): string {
  const [fy, q] = key.split('-');
  return `FY${(fy ?? '').slice(-2)} ${q ?? ''}`;
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
 * Build a sliding window of quarters around today: 4 trailing + current
 * + 4 forward by default. Used as a stable option list for the
 * cross-page FiscalQuarterFilter so the dropdown always renders the
 * same items even when data is sparse.
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
  // ascending sort — matches "FY26 Q4 → FY27 Q1" reading order.
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

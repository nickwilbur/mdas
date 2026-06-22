// Zuora fiscal year starts in February.
// FY{N} = Feb of (N-1) → Jan of N. e.g. FY27 = Feb 2026 → Jan 2027.
// Keep in sync with apps/web/src/lib/fiscal.ts.

/** Earliest fiscal quarter in the standard MDAS reporting window. */
export const FISCAL_HISTORY_START_KEY = '2026-Q1';

/** Rolling forward horizon: current quarter + this many future quarters. */
export const FISCAL_QUARTER_FORWARD_COUNT = 8;

export interface FiscalQuarter {
  fy: number;
  q: 1 | 2 | 3 | 4;
  key: string;
  label: string;
}

export function fiscalQuarterFromDate(
  iso: string | null | undefined,
): FiscalQuarter | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
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

/** Display FY number from a close date, e.g. 2027-08-01 → 2027 (FY27). */
export function fiscalYearFromDate(iso: string | null | undefined): number | null {
  return fiscalQuarterFromDate(iso)?.fy ?? null;
}

function fiscalYearFromKey(key: string): number {
  return parseInt(key.split('-')[0]!, 10);
}

/** The fiscal quarter immediately after `currentKey`. */
export function nextFiscalQuarterKey(currentKey: string): string | null {
  const m = currentKey.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  if (q === 4) return `${fy + 1}-Q1`;
  return `${fy}-Q${q + 1}`;
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

/** Zuora fiscal years touched by the rolling history → forward horizon. */
export function defaultRenewalFiscalYears(
  anchor: Date = new Date(),
  forwardCount = FISCAL_QUARTER_FORWARD_COUNT,
): number[] {
  const startFy = fiscalYearFromKey(FISCAL_HISTORY_START_KEY);
  const endFy = fiscalYearFromKey(fiscalQuarterWindowEndKey(forwardCount, anchor));
  const years: number[] = [];
  for (let fy = startFy; fy <= endFy; fy++) years.push(fy);
  return years;
}

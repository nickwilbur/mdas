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
  return `FY${fy.slice(-2)} ${q}`;
}

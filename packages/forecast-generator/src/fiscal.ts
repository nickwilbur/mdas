// Local mirror of the fiscal-quarter helpers used by the web app.
// Duplicated here (rather than imported from apps/web) so the
// @mdas/forecast-generator package remains a leaf dependency with no
// reverse pointer up into Next.js code. Keep these two files in sync;
// the canonical version is apps/web/src/lib/fiscal.ts.

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

export function fiscalQuarterLabel(key: string): string {
  const [fy, q] = key.split('-');
  return `FY${(fy ?? '').slice(-2)} ${q ?? ''}`;
}

/**
 * UTC ISO date (YYYY-MM-DD) of the first day of the given Zuora
 * fiscal quarter. Zuora's FY starts Feb 1, so:
 *
 *   FY27 Q1 → 2026-02-01
 *   FY27 Q2 → 2026-05-01
 *   FY27 Q3 → 2026-08-01
 *   FY27 Q4 → 2026-11-01
 *
 * Used by the Health Snapshot trajectory loader to bound the
 * "snapshots in the quarter so far" query (anything before quarter
 * start belongs to a different quarter's narrative).
 */
export function fiscalQuarterStart(fq: FiscalQuarter): string {
  // FY N runs Feb N-1 → Jan N. Q1=Feb, Q2=May, Q3=Aug, Q4=Nov.
  const startMonthByQ: Record<1 | 2 | 3 | 4, number> = {
    1: 2,
    2: 5,
    3: 8,
    4: 11,
  };
  // Calendar year of the quarter's start month:
  //   Q1/Q2/Q3 start in calendar year FY-1
  //   Q4 starts in November of FY-1 (still FY-1)
  const calendarYear = fq.fy - 1;
  const month = startMonthByQ[fq.q];
  return `${calendarYear}-${String(month).padStart(2, '0')}-01`;
}

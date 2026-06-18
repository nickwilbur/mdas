// Zuora fiscal year starts in February.
// FY{N} = Feb of (N-1) → Jan of N. e.g. FY27 = Feb 2026 → Jan 2027.
// Keep in sync with apps/web/src/lib/fiscal.ts.

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

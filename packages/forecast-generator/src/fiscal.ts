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

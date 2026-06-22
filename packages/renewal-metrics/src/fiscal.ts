// Zuora fiscal calendar — keep in sync with apps/web/src/lib/fiscal.ts

export interface FiscalQuarter {
  fy: number;
  q: 1 | 2 | 3 | 4;
  key: string;
  label: string;
}

export function parseFiscalQuarterKey(key: string): FiscalQuarter | null {
  const m = key.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10) as 1 | 2 | 3 | 4;
  return {
    fy,
    q,
    key,
    label: `FY${String(fy).slice(-2)} Q${q}`,
  };
}

export function fiscalQuarterKey(fy: number, q: number): string {
  return `${fy}-Q${q}`;
}

export function nextFiscalQuarterKey(currentKey: string): string | null {
  const m = currentKey.match(/^(\d+)-Q([1-4])$/);
  if (!m) return null;
  const fy = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  if (q === 4) return fiscalQuarterKey(fy + 1, 1);
  return fiscalQuarterKey(fy, q + 1);
}

/** UTC ISO date of the last day of the Zuora fiscal quarter. */
export function fiscalQuarterEnd(fq: FiscalQuarter): string {
  const endMonthByQ: Record<1 | 2 | 3 | 4, number> = { 1: 4, 2: 7, 3: 10, 4: 1 };
  const calendarYear = fq.q === 4 ? fq.fy : fq.fy - 1;
  const month = endMonthByQ[fq.q];
  const lastDay = new Date(Date.UTC(calendarYear, month, 0)).getUTCDate();
  return `${calendarYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Evaluation date for a quarter's metrics.
 * Past quarters → quarter end; current/future → min(today, quarter end).
 */
export function asOfDateForQuarter(quarterKey: string, todayIso: string = new Date().toISOString()): string {
  const fq = parseFiscalQuarterKey(quarterKey);
  if (!fq) return todayIso;
  const end = fiscalQuarterEnd(fq);
  const today = todayIso.slice(0, 10);
  const use = today <= end ? today : end;
  return `${use}T23:59:59.000Z`;
}

/** True when the fiscal quarter has fully ended (quarter-close retrospective view). */
export function isQuarterRetrospective(
  quarterKey: string,
  asOfDate: string = new Date().toISOString(),
): boolean {
  const fq = parseFiscalQuarterKey(quarterKey);
  if (!fq) return false;
  return asOfDate.slice(0, 10) > fiscalQuarterEnd(fq);
}

/** True when every selected quarter is in the past (retrospective scope). */
export function isRetrospectiveScope(
  quarterKeys: Set<string> | null | undefined,
  asOfDate: string = new Date().toISOString(),
): boolean {
  if (!quarterKeys || quarterKeys.size === 0) return false;
  return [...quarterKeys].every((k) => isQuarterRetrospective(k, asOfDate));
}

/** Inclusive range of fiscal quarter keys from `fromKey` through `toKey`. */
export function enumerateFiscalQuarterKeys(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let cur: string | null = fromKey;
  let guard = 0;
  while (cur && cur <= toKey && guard++ < 48) {
    out.push(cur);
    cur = nextFiscalQuarterKey(cur);
  }
  return out;
}

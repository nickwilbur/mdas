/**
 * Persist Churn/Downsell **Plan** amounts per fiscal quarter in the browser.
 * Leadership targets rarely change after initial planning; this avoids
 * retyping them on every forecast run.
 */

const STORAGE_KEY = 'mdas.forecast.churnPlanByQuarter.v1';

export type ChurnPlanByQuarter = Record<string, number>;

function isFqKey(k: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(k);
}

export function loadChurnPlansByQuarter(): ChurnPlanByQuarter {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ChurnPlanByQuarter = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isFqKey(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Round-trip a stored number into the plain text input (no locale commas). */
export function formatStoredPlanForInput(usd: number): string {
  return String(Math.round(usd));
}

/**
 * Set or remove one quarter’s plan. Pass `null` to delete that quarter from storage.
 */
export function persistChurnPlanForQuarter(fqKey: string, usd: number | null): void {
  if (typeof window === 'undefined' || !isFqKey(fqKey)) return;
  const all = loadChurnPlansByQuarter();
  if (usd != null && Number.isFinite(usd)) {
    all[fqKey] = usd;
  } else {
    delete all[fqKey];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore quota / private mode
  }
}

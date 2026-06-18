/**
 * Shared churn Flash vs Plan helpers — same semantics as the weekly
 * forecast generator (`formatGapToPlan` in @mdas/forecast-generator).
 * Plan dollars are negative loss budgets; Flash is negative forecast loss.
 */

export const GRR_INTERNAL_GOAL = 0.75;

export function grrMeetsInternalGoal(grr: number | null | undefined): boolean {
  return grr != null && grr >= GRR_INTERNAL_GOAL;
}

export function fmtSignedUSD(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
}

/** |Flash| / |Plan| × 100 — null when Plan is unknown or zero. */
export function flashToPlanPct(
  flashUSD: number,
  planUSD: number | null | undefined,
): number | null {
  if (planUSD == null || planUSD === 0) return null;
  return (Math.abs(flashUSD) / Math.abs(planUSD)) * 100;
}

/**
 * Gap-to-plan line with leadership %ToPlan parenthetical.
 * Under/at plan → green tone; over plan → yellow tone.
 */
export function formatGapToPlan(flashUSD: number, planUSD: number | null | undefined): string {
  if (planUSD == null) return 'Set plan in Forecast (saved per quarter)';
  const gap = flashUSD - planUSD;
  const dollar = fmtSignedUSD(gap);
  if (planUSD === 0) return dollar;
  if (gap === 0) return `${dollar} (at plan)`;
  const pct = flashToPlanPct(flashUSD, planUSD)!;
  const pctStr = pct.toFixed(0);
  const direction = gap > 0 ? 'under plan' : 'over plan';
  return `${dollar} (${pctStr}% ${direction})`;
}

export type PlanPerformanceTone = 'green' | 'yellow' | 'neutral';

/** Flash vs Plan color: under/at plan = green, over plan = yellow. */
export function planPerformanceTone(
  flashUSD: number,
  planUSD: number | null | undefined,
): PlanPerformanceTone | null {
  if (planUSD == null) return null;
  if (planUSD === 0) return 'neutral';
  const gap = flashUSD - planUSD;
  return gap >= 0 ? 'green' : 'yellow';
}

export function planPerformancePctLabel(
  flashUSD: number,
  planUSD: number | null | undefined,
): string | null {
  const pct = flashToPlanPct(flashUSD, planUSD);
  if (pct == null) return null;
  const gap = flashUSD - (planUSD ?? 0);
  if (gap === 0) return `${pct.toFixed(0)}% at plan`;
  const direction = gap > 0 ? 'under plan' : 'over plan';
  return `${pct.toFixed(0)}% ${direction}`;
}

export const PLAN_TONE_STYLES: Record<
  PlanPerformanceTone,
  { border: string; bg: string; text: string; sub: string }
> = {
  green: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/60',
    text: 'text-emerald-950',
    sub: 'text-emerald-800',
  },
  yellow: {
    border: 'border-amber-200',
    bg: 'bg-amber-50/60',
    text: 'text-amber-950',
    sub: 'text-amber-800',
  },
  neutral: {
    border: 'border-gray-200',
    bg: 'bg-gray-50',
    text: 'text-gray-900',
    sub: 'text-gray-600',
  },
};

export const GRR_TONE_STYLES = {
  green: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/50',
    title: 'text-emerald-900',
    value: 'text-emerald-950',
    sub: 'text-emerald-800',
    hint: 'text-emerald-700/80',
  },
  belowGoal: {
    border: 'border-amber-200',
    bg: 'bg-amber-50/50',
    title: 'text-amber-900',
    value: 'text-amber-950',
    sub: 'text-amber-800',
    hint: 'text-amber-700/80',
  },
};

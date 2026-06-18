import {
  applyTrajectoryPlan,
  type QuarterKpiSnapshot,
  type RefreshTrajectoryKpis,
} from '@mdas/forecast-generator';

/** Validate refresh_runs.trajectory_kpis JSON from Postgres. */
export function parseRefreshTrajectoryKpis(raw: unknown): RefreshTrajectoryKpis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<RefreshTrajectoryKpis>;
  if (typeof o.asOfDate !== 'string') return null;
  if (!isQuarterKpiSnapshot(o.current) || !isQuarterKpiSnapshot(o.next)) return null;
  return {
    asOfDate: o.asOfDate,
    current: o.current,
    next: o.next,
  };
}

function isQuarterKpiSnapshot(v: unknown): v is QuarterKpiSnapshot {
  if (!v || typeof v !== 'object') return false;
  const k = v as Partial<QuarterKpiSnapshot>;
  return (
    typeof k.fiscalQuarterKey === 'string' &&
    typeof k.fiscalQuarterLabel === 'string' &&
    typeof k.flashUSD === 'number' &&
    typeof k.totalRiskUSD === 'number' &&
    typeof k.hedgeUSD === 'number' &&
    typeof k.redAccountCount === 'number' &&
    typeof k.yellowAccountCount === 'number' &&
    typeof k.accountCount === 'number' &&
    typeof k.opportunityCount === 'number'
  );
}

export { applyTrajectoryPlan };

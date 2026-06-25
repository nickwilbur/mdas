import {
  applyTrajectoryPlan,
  type QuarterKpiSnapshot,
  type RefreshTrajectoryKpis,
} from '@mdas/forecast-generator';

/** Metadata for pinning the latest trajectory point to script KPIs. */
export interface TrajectoryOverlayMeta {
  refreshId: string;
  refreshStartedAt: string;
}

export interface TrajectoryPointLike {
  date: string;
  refreshId: string;
  refreshStartedAt: string;
  kpis: QuarterKpiSnapshot;
}

export interface ForecastTrajectoryLike {
  asOfDate: string;
  currentQuarter: TrajectoryPointLike[];
  nextQuarter: TrajectoryPointLike[];
}

/**
 * Replace (or append) the latest trajectory point with KPIs computed from
 * the same AccountView[] the forecast script renders. Prevents the Health
 * Snapshot Glean prompt from drifting when historical snapshot rebuilds
 * fail or lag behind a surgical SF re-ingest.
 */
export function overlayAuthoritativeTrajectoryKpis<T extends ForecastTrajectoryLike>(
  trajectory: T,
  kpis: QuarterKpiSnapshot,
  meta: TrajectoryOverlayMeta,
): T {
  const day = meta.refreshStartedAt.slice(0, 10);
  const point: TrajectoryPointLike = {
    date: day,
    refreshId: meta.refreshId,
    refreshStartedAt: meta.refreshStartedAt,
    kpis,
  };
  const points = [...trajectory.currentQuarter];
  if (points.length > 0 && points[points.length - 1]!.date === day) {
    points[points.length - 1] = point as TrajectoryPointLike;
  } else {
    points.push(point);
  }
  return { ...trajectory, currentQuarter: points as T['currentQuarter'] };
}

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

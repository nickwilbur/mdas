import type { WeeklySnapshot, WeekOverWeekComparison } from './types.js';

export function compareSnapshots(
  current: WeeklySnapshot,
  prior: WeeklySnapshot | null,
): WeekOverWeekComparison {
  if (!prior) {
    return {
      currentSnapshotDate: current.metadata.snapshotDate,
      priorSnapshotDate: null,
      deltas: {},
      narrative: ['No prior snapshot available for week-over-week comparison.'],
    };
  }
  const c = current.metadata.derivedMetrics;
  const p = prior.metadata.derivedMetrics;
  const deltas = {
    highValueRenewalRisksWithActivity:
      c.highValueRenewalRisksWithActivity - p.highValueRenewalRisksWithActivity,
    highValueRenewalRisksWithoutActivity:
      c.highValueRenewalRisksWithoutActivity - p.highValueRenewalRisksWithoutActivity,
    accountsWithCustomerFacingActivity:
      c.accountsWithCustomerFacingActivity - p.accountsWithCustomerFacingActivity,
    accountsInternalOnly: c.accountsInternalOnly - p.accountsInternalOnly,
    healthSignalsReviewed: c.healthSignalsReviewed - p.healthSignalsReviewed,
    teamMembersUsingAi: c.teamMembersUsingAi - p.teamMembersUsingAi,
  };
  const narrative: string[] = [];
  if (deltas.accountsWithCustomerFacingActivity > 0) {
    narrative.push(
      `Customer-facing account coverage increased by ${deltas.accountsWithCustomerFacingActivity} vs prior week.`,
    );
  }
  if (deltas.highValueRenewalRisksWithoutActivity > 0) {
    narrative.push(
      `Under-covered high-value renewal risks increased by ${deltas.highValueRenewalRisksWithoutActivity} — manager inspection recommended.`,
    );
  }
  if (narrative.length === 0) {
    narrative.push('Week-over-week portfolio motion was relatively stable on connected sources.');
  }
  return {
    currentSnapshotDate: current.metadata.snapshotDate,
    priorSnapshotDate: prior.metadata.snapshotDate,
    deltas,
    narrative,
  };
}

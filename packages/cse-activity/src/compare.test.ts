import { describe, expect, it } from 'vitest';
import { compareSnapshots } from './compare.js';
import type { DerivedWeekMetrics, WeeklySnapshot } from './types.js';

function derived(overrides: Partial<DerivedWeekMetrics> = {}): DerivedWeekMetrics {
  return {
    highValueRenewalRisksWithActivity: 2,
    highValueRenewalRisksWithoutActivity: 1,
    accountsWithExecutiveEngagement: 1,
    accountsWithCustomerFacingActivity: 4,
    accountsInternalOnly: 2,
    accountsStaleNextSteps: 0,
    healthSignalsReviewed: 3,
    healthSignalsActedOn: 1,
    teamMembersUsingAi: 1,
    aiArtifactsCreated: 2,
    followUpsCreatedOrCompleted: 1,
    accountPlansUpdated: 1,
    ...overrides,
  };
}

function snapshot(
  date: string,
  metrics: DerivedWeekMetrics,
): WeeklySnapshot {
  return {
    metadata: {
      generatedAt: `${date}T17:00:00.000Z`,
      reportingWindowStart: `${date}T00:00:00.000Z`,
      reportingWindowEnd: `${date}T23:59:59.999Z`,
      timezone: 'America/Denver',
      snapshotDate: date,
      dataSourcesAttempted: [],
      dataSourcesSuccessful: [],
      dataSourcesFailed: [],
      teamMembersIncluded: [],
      accountsIncluded: [],
      knownDataGaps: [],
      immutable: true,
      derivedMetrics: metrics,
      overallStatus: 'Yellow',
      strategicPosture: 'Mixed',
      confidenceLevel: 'Medium',
      dataCoverage: 'Partial',
    },
    teamActivity: [],
    accountActivity: [],
    teamMetrics: [],
    accountMetrics: [],
    sourceCoverage: [],
    calendarActivity: [],
    slackActivity: [],
    crmActivity: [],
    renewalRiskActivity: [],
    aiEnablementActivity: [],
  };
}

describe('compareSnapshots', () => {
  it('returns empty deltas when no prior snapshot exists', () => {
    const current = snapshot('2026-06-19', derived());
    const out = compareSnapshots(current, null);

    expect(out.priorSnapshotDate).toBeNull();
    expect(out.deltas).toEqual({});
    expect(out.narrative[0]).toMatch(/No prior snapshot/i);
  });

  it('computes week-over-week metric deltas', () => {
    const prior = snapshot(
      '2026-06-12',
      derived({
        accountsWithCustomerFacingActivity: 2,
        highValueRenewalRisksWithoutActivity: 0,
      }),
    );
    const current = snapshot(
      '2026-06-19',
      derived({
        accountsWithCustomerFacingActivity: 5,
        highValueRenewalRisksWithoutActivity: 2,
      }),
    );

    const out = compareSnapshots(current, prior);
    expect(out.deltas.accountsWithCustomerFacingActivity).toBe(3);
    expect(out.deltas.highValueRenewalRisksWithoutActivity).toBe(2);
  });

  it('flags increased customer-facing coverage and under-covered renewal risks', () => {
    const prior = snapshot('2026-06-12', derived({ accountsWithCustomerFacingActivity: 1 }));
    const current = snapshot(
      '2026-06-19',
      derived({
        accountsWithCustomerFacingActivity: 4,
        highValueRenewalRisksWithoutActivity: 3,
      }),
    );

    const out = compareSnapshots(current, prior);
    expect(out.narrative.some((n) => /Customer-facing account coverage increased/i.test(n))).toBe(
      true,
    );
    expect(out.narrative.some((n) => /Under-covered high-value renewal risks increased/i.test(n)))
      .toBe(true);
  });

  it('reports stable motion when deltas are flat', () => {
    const metrics = derived({ accountsWithCustomerFacingActivity: 3 });
    const out = compareSnapshots(snapshot('2026-06-19', metrics), snapshot('2026-06-12', metrics));
    expect(out.narrative[0]).toMatch(/relatively stable/i);
  });
});

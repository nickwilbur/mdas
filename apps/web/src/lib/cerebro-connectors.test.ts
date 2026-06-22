import { describe, expect, it } from 'vitest';
import { summarizeCerebroSnapshotQuality } from './cerebro-connectors';

describe('summarizeCerebroSnapshotQuality', () => {
  it('counts accounts with Engage-only Risk Category separately from Glean booleans', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 500_000,
        cerebroRiskCategory: 'High',
        cerebroRisks: { utilizationRisk: true },
      },
      {
        allTimeARR: 200_000,
        cerebroRiskCategory: null,
        cerebroRisks: { engagementRisk: false },
      },
      {
        allTimeARR: 100_000,
        cerebroRiskCategory: null,
        cerebroRisks: null,
        lastFetchedFromSource: { cerebro: '2026-06-01' },
      },
      {
        allTimeARR: 50_000,
        cerebroRiskCategory: null,
        cerebroRisks: null,
      },
    ]);

    expect(summary).toEqual({
      withRiskCategory: 1,
      withRiskCategoryARR: 500_000,
      withBooleansOnly: 2,
      withBooleansOnlyARR: 300_000,
      withNeither: 1,
      withNeitherARR: 50_000,
      total: 4,
    });
  });

  it('treats Risk Category as authoritative over booleans-only path', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 1_000_000,
        cerebroRiskCategory: 'Medium',
        cerebroRisks: { utilizationRisk: true },
        lastFetchedFromSource: { cerebro: '2026-06-01' },
      },
    ]);

    expect(summary.withRiskCategory).toBe(1);
    expect(summary.withBooleansOnly).toBe(0);
  });

  it('returns zeros for an empty account list', () => {
    expect(summarizeCerebroSnapshotQuality([])).toEqual({
      withRiskCategory: 0,
      withRiskCategoryARR: 0,
      withBooleansOnly: 0,
      withBooleansOnlyARR: 0,
      withNeither: 0,
      withNeitherARR: 0,
      total: 0,
    });
  });
});

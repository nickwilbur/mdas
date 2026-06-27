import { describe, expect, it } from 'vitest';
import { summarizeCerebroSnapshotQuality } from './cerebro-connectors';

describe('summarizeCerebroSnapshotQuality', () => {
  it('counts Engage-only risk category vs Glean-only enrichment vs neither', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 500_000,
        cerebroRiskCategory: 'High',
        cerebroRisks: { utilizationRisk: true },
      },
      {
        allTimeARR: 200_000,
        cerebroRiskCategory: null,
        cerebroRisks: { engagementRisk: true },
        lastFetchedFromSource: { cerebro: '2026-06-01' },
      },
      {
        allTimeARR: 50_000,
        cerebroRiskCategory: null,
        cerebroRisks: { suiteRisk: false },
      },
      {
        allTimeARR: 10_000,
        cerebroRiskCategory: null,
        cerebroRisks: null,
      },
    ]);

    expect(summary).toEqual({
      withRiskCategory: 1,
      withRiskCategoryARR: 500_000,
      withBooleansOnly: 2,
      withBooleansOnlyARR: 250_000,
      withNeither: 1,
      withNeitherARR: 10_000,
      total: 4,
    });
  });

  it('treats cerebro touch without booleans as Glean-only bucket', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 75_000,
        cerebroRiskCategory: null,
        cerebroRisks: null,
        lastFetchedFromSource: { cerebro: '2026-06-20' },
      },
    ]);

    expect(summary.withBooleansOnly).toBe(1);
    expect(summary.withNeither).toBe(0);
  });
});

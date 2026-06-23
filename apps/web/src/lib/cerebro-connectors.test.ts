import { describe, expect, it } from 'vitest';
import { summarizeCerebroSnapshotQuality } from './cerebro-connectors';

describe('summarizeCerebroSnapshotQuality', () => {
  it('counts accounts with Engage-only Risk Category separately from Glean booleans', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: 100_000,
        cerebroRiskCategory: 'High',
        cerebroRisks: { engagementRisk: true },
      },
      {
        allTimeARR: 50_000,
        cerebroRiskCategory: null,
        cerebroRisks: { utilizationRisk: true },
        lastFetchedFromSource: { cerebro: '2026-06-16T00:00:00Z' },
      },
      {
        allTimeARR: 25_000,
        cerebroRiskCategory: null,
        cerebroRisks: null,
      },
    ]);

    expect(summary).toEqual({
      withRiskCategory: 1,
      withRiskCategoryARR: 100_000,
      withBooleansOnly: 1,
      withBooleansOnlyARR: 50_000,
      withNeither: 1,
      withNeitherARR: 25_000,
      total: 3,
    });
  });

  it('treats touched cerebro stamp without category as booleans-only bucket', () => {
    const summary = summarizeCerebroSnapshotQuality([
      {
        allTimeARR: null,
        cerebroRiskCategory: null,
        cerebroRisks: null,
        lastFetchedFromSource: { cerebro: '2026-06-15T00:00:00Z' },
      },
    ]);
    expect(summary.withBooleansOnly).toBe(1);
    expect(summary.withNeither).toBe(0);
  });
});

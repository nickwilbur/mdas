import { describe, expect, it } from 'vitest';
import { buildAccountViewWithDefaults, withAccountDefaults } from './account-defaults';
import type { CanonicalAccount } from '@mdas/canonical';

const sparseAccount = {
  accountId: 'A-sparse',
  salesforceAccountId: '001sparse',
  accountName: 'Sparse Co',
  zuoraTenantId: null,
  accountOwner: null,
  assignedCSE: null,
  csCoverage: null,
  franchise: 'Expand 3',
  cseSentiment: 'Green',
  cseSentimentCommentary: null,
  cseSentimentLastUpdated: null,
  cseSentimentCommentaryLastUpdated: null,
  cerebroRiskCategory: 'Medium',
  cerebroRiskAnalysis: null,
  allTimeARR: 100_000,
  engagementMinutes30d: null,
  engagementMinutes90d: null,
  isConfirmedChurn: false,
  churnReason: null,
  churnReasonSummary: null,
  churnDate: null,
} as CanonicalAccount;

describe('withAccountDefaults', () => {
  it('fills collections and cerebro defaults required by scoring', () => {
    const filled = withAccountDefaults(sparseAccount);
    expect(filled.workshops).toEqual([]);
    expect(filled.recentMeetings).toEqual([]);
    expect(filled.gainsightTasks).toEqual([]);
    expect(filled.activeProductLines).toEqual([]);
    expect(filled.cerebroSubMetrics).toEqual({});
    expect(filled.cerebroRisks).toEqual({
      utilizationRisk: null,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    });
    expect(filled.lastFetchedFromSource).toEqual({});
    expect(filled.lastUpdated).toBeTruthy();
  });
});

describe('buildAccountViewWithDefaults', () => {
  it('passes prevRiskCategory through to upsell scoring', () => {
    const view = buildAccountViewWithDefaults(
      { ...sparseAccount, cerebroRiskCategory: 'Low' },
      [],
      { prevRiskCategory: 'High' },
    );
    expect(
      view.upsell.signals.find((s) => s.label === 'Cerebro Risk Category improved WoW'),
    ).toBeTruthy();
  });
});

import { describe, it, expect } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { filterExpand3Views, isChurnedAccount } from './scope.js';

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: null,
    assignedCSE: null,
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Green',
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: null,
    cerebroRiskCategory: null,
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: null,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    cerebroSubMetrics: {},
    allTimeARR: 50_000,
    activeProductLines: [],
    engagementMinutes30d: null,
    engagementMinutes90d: null,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

describe('filterExpand3Views', () => {
  it('excludes non-Expand 3 and churned accounts', () => {
    const views = [
      buildAccountView(acct(), []),
      buildAccountView(acct({ franchise: 'Enterprise', accountId: '002', salesforceAccountId: '002' }), []),
      buildAccountView(acct({ cseSentiment: 'Confirmed Churn', accountId: '003', salesforceAccountId: '003' }), []),
    ];
    const out = filterExpand3Views(views);
    expect(out).toHaveLength(1);
    expect(out[0]!.account.accountId).toBe('001');
  });

  it('detects churned accounts', () => {
    const view = buildAccountView(acct({ cseSentiment: 'Confirmed Churn' }), []);
    expect(isChurnedAccount(view)).toBe(true);
  });
});

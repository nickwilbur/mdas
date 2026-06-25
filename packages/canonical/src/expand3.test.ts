import { describe, it, expect } from 'vitest';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { isConfirmedChurn } from '@mdas/canonical';
import { filterExpand3Snapshot, isActiveExpand3Account } from './expand3.js';

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

describe('filterExpand3Snapshot', () => {
  it('drops non-Expand 3 and churned accounts and orphan opps', () => {
    const accounts = [
      acct(),
      acct({ accountId: '002', salesforceAccountId: '002', franchise: 'Enterprise' }),
      acct({ accountId: '003', salesforceAccountId: '003', cseSentiment: 'Confirmed Churn' }),
    ];
    const opportunities: CanonicalOpportunity[] = [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: 'Open',
        stageNum: 1,
        closeDate: '2026-12-01',
        closeQuarter: 'Q4',
        fiscalYear: 2026,
        acv: 10_000,
        availableToRenewUSD: 10_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
      {
        opportunityId: 'o2',
        opportunityName: 'Orphan',
        accountId: '002',
        type: 'Renewal',
        stageName: 'Open',
        stageNum: 1,
        closeDate: '2026-12-01',
        closeQuarter: 'Q4',
        fiscalYear: 2026,
        acv: 5_000,
        availableToRenewUSD: 5_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ];
    const out = filterExpand3Snapshot({ accounts, opportunities });
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]!.accountId).toBe('001');
    expect(out.opportunities).toHaveLength(1);
    expect(out.opportunities[0]!.opportunityId).toBe('o1');
  });

  it('keeps confirmed full churn renewal opps in snapshot for renewal metrics', () => {
    const account = acct();
    const opps: CanonicalOpportunity[] = [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: '4.0 Propose',
        stageNum: 4,
        closeDate: '2026-12-01',
        closeQuarter: 'Q4',
        fiscalYear: 2026,
        acv: 10_000,
        availableToRenewUSD: 10_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        churnRisk: 'Confirmed Full Churn',
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ];
    expect(isActiveExpand3Account(account, opps)).toBe(true);
    expect(isConfirmedChurn(account, opps)).toBe(false);
  });

  it('rejects confirmed churn via opportunity notice fields', () => {
    const account = acct();
    const opps: CanonicalOpportunity[] = [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: 'Closed',
        stageNum: 9,
        closeDate: '2026-01-01',
        closeQuarter: 'Q1',
        fiscalYear: 2026,
        acv: 10_000,
        availableToRenewUSD: 10_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: 'Confirmed',
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: 10_000,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: '2026-01-01',
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ];
    expect(isActiveExpand3Account(account, opps)).toBe(false);
  });

  it('rejects churn customer status from Salesforce', () => {
    expect(isActiveExpand3Account(acct({ customerStatus: 'Churned (Live)' }), [])).toBe(
      false,
    );
  });

  it('retains churned-live accounts with in-quarter churn-grid renewal opps', () => {
    const account = acct({ customerStatus: 'Churned (Live)', accountName: 'Bird' });
    const opps: CanonicalOpportunity[] = [
      {
        opportunityId: 'o-bird',
        opportunityName: 'Bird Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: '8.0 - Closed/Won',
        stageNum: 8,
        closeDate: '2026-05-08',
        closeQuarter: 'Q2',
        fiscalYear: 2027,
        acv: 200_000,
        availableToRenewUSD: 200_000,
        forecastMostLikely: -199_904,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: -199_904,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ];
    const out = filterExpand3Snapshot(
      { accounts: [account], opportunities: opps },
      { asOfDate: '2026-06-25' },
    );
    expect(out.accounts).toHaveLength(1);
    expect(out.opportunities).toHaveLength(1);
    expect(
      isActiveExpand3Account(account, opps, { asOfDate: '2026-06-25' }),
    ).toBe(true);
    expect(isActiveExpand3Account(account, opps)).toBe(false);
  });

  it('rejects accounts with churn reason and no future open renewal (WellSky pattern)', () => {
    const account = acct({
      accountName: 'WellSky Corporation',
      cseSentiment: 'Red',
      churnReason: 'M&A',
      churnReasonSummary: 'Moving to parent company system',
    });
    const opps: CanonicalOpportunity[] = [
      {
        opportunityId: 'o1',
        opportunityName: 'WellSky Renewal February 2025',
        accountId: '001',
        type: 'Renewal',
        stageName: '8.0 - Closed/Won (Finance)',
        stageNum: 8,
        closeDate: '2025-02-03',
        closeQuarter: 'Q1',
        fiscalYear: 2025,
        acv: 40_000,
        availableToRenewUSD: 40_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: null,
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ];
    expect(isActiveExpand3Account(account, opps)).toBe(false);
  });
});

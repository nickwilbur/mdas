import { describe, it, expect } from 'vitest';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { fiscalYearFromDate, fiscalQuarterWindowEndKey, defaultRenewalFiscalYears } from './fiscal.js';
import { hasOpenRenewalInFiscalYears } from './scope.js';

describe('fiscalYearFromDate', () => {
  it('maps Zuora FY27 dates', () => {
    expect(fiscalYearFromDate('2026-03-01')).toBe(2027);
    expect(fiscalYearFromDate('2027-01-15')).toBe(2027);
  });

  it('maps Zuora FY28 dates', () => {
    expect(fiscalYearFromDate('2027-03-01')).toBe(2028);
  });
});

describe('fiscal horizon', () => {
  const ANCHOR = new Date('2026-06-16T12:00:00Z');

  it('ends at current quarter + 8 forward from anchor', () => {
    expect(fiscalQuarterWindowEndKey(8, ANCHOR)).toBe('2029-Q2');
  });

  it('defaultRenewalFiscalYears spans FY26 through forward horizon', () => {
    expect(defaultRenewalFiscalYears(ANCHOR)).toEqual([2026, 2027, 2028, 2029]);
  });
});

function renewalOpp(closeDate: string): CanonicalOpportunity {
  return {
    opportunityId: 'opp-1',
    opportunityName: 'Renewal',
    accountId: '001',
    type: 'Renewal',
    stageName: 'Discovery',
    stageNum: 1,
    closeDate,
    closeQuarter: '',
    fiscalYear: 2027,
    acv: 100_000,
    availableToRenewUSD: 100_000,
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
  };
}

function acct(): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: null,
    assignedCSE: { id: 'cse', name: 'CSE' },
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
  };
}

describe('hasOpenRenewalInFiscalYears', () => {
  const now = Date.parse('2026-06-16T12:00:00Z');

  it('includes FY27 renewal', () => {
    const view = buildAccountView(acct(), [renewalOpp('2026-09-30')]);
    expect(hasOpenRenewalInFiscalYears(view, [2027, 2028], now)).toBe(true);
  });

  it('excludes FY26 renewal', () => {
    const view = buildAccountView(acct(), [renewalOpp('2026-01-31')]);
    expect(hasOpenRenewalInFiscalYears(view, [2027, 2028], now)).toBe(false);
  });

  it('includes FY28 renewal', () => {
    const view = buildAccountView(acct(), [renewalOpp('2027-08-15')]);
    expect(hasOpenRenewalInFiscalYears(view, [2027, 2028], now)).toBe(true);
  });
});

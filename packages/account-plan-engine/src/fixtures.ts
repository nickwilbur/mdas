import type { CanonicalAccount, CanonicalOpportunity, AccountView } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';

export function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Acme Corp',
    zuoraTenantId: null,
    accountOwner: { id: 'ae', name: 'AE' },
    assignedCSE: { id: 'cse', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Green',
    cseSentimentCommentary: 'Stable renewal.',
    cseSentimentLastUpdated: '2026-06-01T00:00:00Z',
    cseSentimentCommentaryLastUpdated: '2026-06-01T00:00:00Z',
    cerebroRiskCategory: 'Low',
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
    allTimeARR: 100_000,
    activeProductLines: ['Billing'],
    engagementMinutes30d: 10,
    engagementMinutes90d: 40,
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

export function renewalOpp(
  closeDate: string,
  overrides: Partial<CanonicalOpportunity> = {},
): CanonicalOpportunity {
  return {
    opportunityId: 'opp-1',
    opportunityName: 'Renewal FY27',
    accountId: '001',
    type: 'Renewal',
    stageName: 'Discovery',
    stageNum: 2,
    closeDate,
    closeQuarter: 'Q2 FY27',
    fiscalYear: 2027,
    acv: 100_000,
    availableToRenewUSD: 100_000,
    forecastMostLikely: 95_000,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: 'Medium',
    forecastHedgeUSD: null,
    acvDelta: -5_000,
    knownChurnUSD: null,
    productLine: 'Billing',
    flmNotes: null,
    slmNotes: null,
    scNextSteps: null,
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

export function testView(
  overrides: Partial<CanonicalAccount> = {},
  opps: CanonicalOpportunity[] = [],
): AccountView {
  return buildAccountView(acct(overrides), opps);
}

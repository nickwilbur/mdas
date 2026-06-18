import { describe, it, expect } from 'vitest';
import type { AccountView, CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { computeCtaDeadline } from './deadline.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');
const SCAN = '2026-06-16';

function baseAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'TestCo',
    zuoraTenantId: null,
    accountOwner: { id: 'a', name: 'AE' },
    assignedCSE: { id: 'c', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Yellow',
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
    allTimeARR: 100_000,
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

describe('computeCtaDeadline', () => {
  it('never returns a deadline before scan date or today', () => {
    const view = buildAccountView(baseAccount(), [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: 'Open',
        stageNum: 3,
        closeDate: '2025-02-03',
        closeQuarter: 'Q1',
        fiscalYear: 2025,
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
      },
    ]);
    const { deadline } = computeCtaDeadline(view, SCAN, NOW);
    expect(deadline >= SCAN).toBe(true);
    expect(deadline >= '2026-06-17').toBe(true);
  });

  it('uses renewal minus 7d when renewal is soon and in the future', () => {
    const view = buildAccountView(baseAccount(), [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: 'Open',
        stageNum: 3,
        closeDate: '2026-07-01',
        closeQuarter: 'Q3',
        fiscalYear: 2026,
        acv: 100_000,
        availableToRenewUSD: 250_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: null,
        slmNotes: null,
        scNextSteps: 'Plan',
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-06-16T00:00:00Z',
      },
    ]);
    const { deadline } = computeCtaDeadline(view, SCAN, NOW);
    expect(deadline).toBe('2026-06-24');
  });
});

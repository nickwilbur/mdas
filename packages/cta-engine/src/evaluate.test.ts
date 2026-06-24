import { describe, it, expect } from 'vitest';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { evaluateAccount } from './index.js';

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Green Renewal Co',
    zuoraTenantId: null,
    accountOwner: { id: 'ae', name: 'AE' },
    assignedCSE: { id: 'cse', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Green',
    cseSentimentCommentary: 'Customer is stable; renewal planning underway.',
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
    cerebroSubMetrics: { crExecutiveMeetingCount: 0 },
    allTimeARR: 200_000,
    activeProductLines: [],
    engagementMinutes30d: 25,
    engagementMinutes90d: 80,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [{ id: 'w1', engagementType: 'QBR', status: 'Complete', workshopDate: '2026-05-01' }],
    recentMeetings: [{ source: 'calendar', title: 'Sync', startTime: '2026-05-15T00:00:00Z', attendees: [] }],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: 'https://slack.example/C123',
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function renewalOpp(
  closeDate: string,
  overrides: Partial<CanonicalOpportunity> = {},
): CanonicalOpportunity {
  return {
    opportunityId: 'opp-1',
    opportunityName: 'Renewal',
    accountId: '001',
    type: 'Renewal',
    stageName: 'Discovery',
    stageNum: 3,
    closeDate,
    closeQuarter: '',
    fiscalYear: 2027,
    acv: 200_000,
    availableToRenewUSD: 200_000,
    forecastMostLikely: null,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: null,
    forecastHedgeUSD: null,
    acvDelta: null,
    knownChurnUSD: null,
    productLine: null,
    flmNotes: null,
    slmNotes: null,
    scNextSteps: 'Customer confirmed Q3 planning session.',
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

describe('evaluateAccount Green sentiment', () => {
  const now = Date.parse('2026-06-16T12:00:00Z');

  it('emits a risk CTA for Green account with renewal and engagement gaps', () => {
    const view = buildAccountView(acct(), [renewalOpp('2026-09-30')]);
    const result = evaluateAccount(view, { now, scanDate: '2026-06-16' });
    expect(result.suppressed).toBe(false);
    expect(result.cta?.play_type).toBe('no_strategic_engagement');
    expect(result.cta?.renewal_opportunity_id).toBe('opp-1');
  });

  it('suppresses data_quality_gap when Green account has no other risk signals', () => {
    const view = buildAccountView(
      acct({
        allTimeARR: 250_000,
        cerebroRiskCategory: 'Low',
        cerebroSubMetrics: { crExecutiveMeetingCount: 2 },
        sourceErrors: { cerebro: 'timeout', 'glean-mcp': 'unavailable' },
        lastFetchedFromSource: {},
        recentMeetings: [
          { source: 'calendar', title: 'Sync', startTime: '2026-06-10T00:00:00Z', attendees: [] },
        ],
      }),
      [renewalOpp('2027-05-15')],
    );
    const result = evaluateAccount(view, { now, scanDate: '2026-06-16' });
    expect(result.cta).toBeNull();
    expect(result.suppressed_reason).toBe('Healthy — no dark signals or identified risk');
  });
});

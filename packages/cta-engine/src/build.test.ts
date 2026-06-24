import { describe, it, expect } from 'vitest';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { buildCTARecord } from './build.js';
import { DEFAULT_CTA_CONFIG } from './config.js';
import type { PlayCandidate } from './rules.js';

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001ACC',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: { id: 'ae', name: 'AE' },
    assignedCSE: { id: 'cse', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Red',
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: null,
    cerebroRiskCategory: 'High',
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: true,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    cerebroSubMetrics: { crExecutiveMeetingCount: 0 },
    allTimeARR: 100_000,
    activeProductLines: [],
    engagementMinutes30d: 5,
    engagementMinutes90d: 10,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: null,
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function renewalOpp(): CanonicalOpportunity {
  return {
    opportunityId: '006Po00000RENEWAL1',
    opportunityName: 'Acme Renewal FY27',
    accountId: '001',
    type: 'Renewal',
    stageName: 'Discovery',
    stageNum: 3,
    closeDate: '2026-09-30',
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
    sourceLinks: [
      {
        source: 'salesforce',
        url: 'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000RENEWAL1/view',
      },
    ],
    lastUpdated: '2026-06-16T00:00:00Z',
  };
}

const candidate: PlayCandidate = {
  play_type: 'dark_renewal',
  priority_score: 80,
  confidence: 'medium',
  drivers: ['No recent activity'],
  data_gaps: [],
  source_signals: [],
};

describe('buildCTARecord', () => {
  const now = Date.parse('2026-06-16T12:00:00Z');

  it('links CTA to renewal opportunity id and opportunity-scoped dedup key', () => {
    const view = buildAccountView(acct(), [renewalOpp()]);
    const cta = buildCTARecord(view, candidate, '2026-06-16', DEFAULT_CTA_CONFIG, now);

    expect(cta.renewal_opportunity_id).toBe('006Po00000RENEWAL1');
    expect(cta.renewal_opportunity_name).toBe('Acme Renewal FY27');
    expect(cta.dedup_key).toBe('006Po00000RENEWAL1:dark_renewal');
  });
});

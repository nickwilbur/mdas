import { describe, it, expect } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { evaluatePlayCandidates, pickBestPlay } from './rules.js';
import { DEFAULT_CTA_CONFIG } from './config.js';

const NOW = Date.parse('2026-05-12T12:00:00Z');
const SCAN = '2026-05-12';

function baseAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'TestCo',
    zuoraTenantId: null,
    accountOwner: { id: 'a', name: 'AE' },
    assignedCSE: { id: 'c', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: '',
    cseSentiment: 'Red',
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
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
    cerebroSubMetrics: { 'Projected Billing Utilization (%)': 42 },
    allTimeARR: 1_000_000,
    activeProductLines: [],
    engagementMinutes30d: 0,
    engagementMinutes90d: 0,
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
    lastUpdated: '2026-05-12T00:00:00Z',
    ...overrides,
  };
}

describe('evaluatePlayCandidates', () => {
  it('prioritizes utilization_risk when Cerebro flags usage and activity is recent', () => {
    const view = buildAccountView(
      baseAccount({
        cseSentimentCommentaryLastUpdated: '2026-05-10T00:00:00Z',
        salesforceSlackChannelUrl: 'https://slack.example/C1',
        recentMeetings: [
          {
            source: 'calendar',
            title: 'QBR',
            startTime: '2026-05-10T15:00:00Z',
            attendees: [],
            summary: null,
            url: null,
          },
        ],
        engagementMinutes30d: 50,
      }),
      [
      {
        opportunityId: 'o1',
        opportunityName: 'Renewal',
        accountId: '001',
        type: 'Renewal',
        stageName: 'Negotiation',
        stageNum: 4,
        closeDate: '2026-06-01',
        closeQuarter: 'Q2',
        fiscalYear: 2026,
        acv: 1_000_000,
        availableToRenewUSD: 1_000_000,
        forecastMostLikely: null,
        forecastMostLikelyOverride: null,
        mostLikelyConfidence: null,
        forecastHedgeUSD: null,
        acvDelta: null,
        knownChurnUSD: null,
        productLine: null,
        flmNotes: 'notes',
        slmNotes: null,
        scNextSteps: 'Next step here',
        salesEngineer: null,
        fullChurnNotificationToOwnerDate: null,
        fullChurnFinalEmailSentDate: null,
        churnDownsellReason: null,
        sourceLinks: [],
        lastUpdated: '2026-05-12T00:00:00Z',
      },
    ],
    );
    const candidates = evaluatePlayCandidates({
      view,
      config: DEFAULT_CTA_CONFIG,
      now: NOW,
      scanDate: SCAN,
    });
    const best = pickBestPlay(candidates);
    expect(best?.play_type).toBe('utilization_risk');
  });

  it('selects dark_account when engagement signals are absent', () => {
    const view = buildAccountView(
      baseAccount({
        cseSentiment: 'Green',
        cerebroRisks: {
          utilizationRisk: null,
          engagementRisk: true,
          suiteRisk: null,
          shareRisk: null,
          legacyTechRisk: null,
          expertiseRisk: null,
          pricingRisk: null,
        },
        cerebroSubMetrics: {},
        assignedCSE: null,
        csCoverage: 'Digital',
      }),
      [],
    );
    const candidates = evaluatePlayCandidates({
      view,
      config: DEFAULT_CTA_CONFIG,
      now: NOW,
      scanDate: SCAN,
    });
    expect(candidates.some((c) => c.play_type === 'dark_account')).toBe(true);
  });
});

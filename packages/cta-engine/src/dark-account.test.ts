import { describe, it, expect } from 'vitest';
import type { AccountView, CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { assessDarkAccount, findSimpleDarkAccounts } from './dark-account.js';
import { DEFAULT_CTA_CONFIG } from './config.js';

const NOW = Date.parse('2026-05-12T12:00:00Z');

function makeAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001TEST',
    salesforceAccountId: '001TEST',
    accountName: 'Acme Corp',
    zuoraTenantId: null,
    accountOwner: { id: '1', name: 'AE Owner' },
    assignedCSE: { id: '2', name: 'CSE Owner' },
    csCoverage: 'CSE',
    franchise: 'Enterprise',
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
    allTimeARR: 250_000,
    activeProductLines: [],
    engagementMinutes30d: 5,
    engagementMinutes90d: 20,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: 'https://slack.example/C123',
    sourceLinks: [],
    lastUpdated: '2026-05-12T00:00:00Z',
    ...overrides,
  };
}

function makeView(account: CanonicalAccount): AccountView {
  return buildAccountView(account, [
    {
      opportunityId: 'opp1',
      opportunityName: 'Acme Renewal',
      accountId: account.accountId,
      type: 'Renewal',
      stageName: 'Stage 2',
      stageNum: 2,
      closeDate: '2026-08-01',
      closeQuarter: 'Q3',
      fiscalYear: 2026,
      acv: 250_000,
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
      scNextSteps: null,
      salesEngineer: null,
      fullChurnNotificationToOwnerDate: null,
      fullChurnFinalEmailSentDate: null,
      churnDownsellReason: null,
      sourceLinks: [],
      lastUpdated: '2026-05-12T00:00:00Z',
    },
  ]);
}

describe('assessDarkAccount', () => {
  it('flags account as dark when multiple signals fire', () => {
    const view = makeView(
      makeAccount({
        cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
        recentMeetings: [],
        engagementMinutes30d: 0,
        cerebroRisks: { ...makeAccount().cerebroRisks, engagementRisk: true },
      }),
    );
    const result = assessDarkAccount(view, DEFAULT_CTA_CONFIG, NOW);
    expect(result.isDark).toBe(true);
    expect(result.weightedScore).toBeGreaterThanOrEqual(2);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag account with recent activity', () => {
    const view = makeView(
      makeAccount({
        cseSentimentCommentaryLastUpdated: '2026-05-10T00:00:00Z',
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
        engagementMinutes30d: 120,
      }),
    );
    const result = assessDarkAccount(view, DEFAULT_CTA_CONFIG, NOW);
    expect(result.isDark).toBe(false);
  });

  it('returns low confidence for structural-only signals', () => {
    const view = makeView(
      makeAccount({
        assignedCSE: null,
        csCoverage: 'Digital',
        salesforceSlackChannelUrl: null,
        cseSentimentCommentaryLastUpdated: '2026-05-10T00:00:00Z',
        recentMeetings: [
          {
            source: 'calendar',
            title: 'Check-in',
            startTime: '2026-05-10T15:00:00Z',
            attendees: [],
            summary: null,
            url: null,
          },
        ],
        engagementMinutes30d: 100,
      }),
    );
    const result = assessDarkAccount(view, DEFAULT_CTA_CONFIG, NOW);
    expect(result.confidence).toBe('low');
  });
});

describe('findSimpleDarkAccounts', () => {
  it('returns accounts with no recent signal in 7d window', () => {
    const view = makeView(
      makeAccount({
        cseSentimentCommentaryLastUpdated: '2026-04-01T00:00:00Z',
      }),
    );
    const dark = findSimpleDarkAccounts([view], { windowDays: 7, now: NOW });
    expect(dark).toHaveLength(1);
    expect(dark[0]!.accountName).toBe('Acme Corp');
  });
});

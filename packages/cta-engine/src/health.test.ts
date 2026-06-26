import { describe, it, expect } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { DEFAULT_CTA_CONFIG } from './config.js';
import { accountNeedsCtaAttention } from './health.js';

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
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
    cseSentimentCommentary: 'Stable account; no action plan documented.',
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
    allTimeARR: 50_000,
    activeProductLines: [],
    engagementMinutes30d: 50,
    engagementMinutes90d: 200,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [{ id: 'w1', engagementType: 'QBR', status: 'Complete', workshopDate: '2026-05-01' }],
    recentMeetings: [
      {
        source: 'calendar',
        title: 'Check-in',
        startTime: '2026-06-01T00:00:00Z',
        attendees: [],
        summary: null,
        url: null,
      },
    ],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: 'https://slack.example/C123',
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

const now = Date.parse('2026-06-16T12:00:00Z');

describe('accountNeedsCtaAttention', () => {
  it('returns false for a healthy green account', () => {
    const view = buildAccountView(acct(), []);
    const result = accountNeedsCtaAttention(view, DEFAULT_CTA_CONFIG, now);
    expect(result.needsAttention).toBe(false);
  });

  it('flags yellow sentiment', () => {
    const view = buildAccountView(acct({ cseSentiment: 'Yellow' }), []);
    expect(accountNeedsCtaAttention(view, DEFAULT_CTA_CONFIG, now).needsAttention).toBe(true);
  });

  it('flags cerebro engagement risk', () => {
    const view = buildAccountView(
      acct({
        cerebroRisks: {
          utilizationRisk: null,
          engagementRisk: true,
          suiteRisk: null,
          shareRisk: null,
          legacyTechRisk: null,
          expertiseRisk: null,
          pricingRisk: null,
        },
      }),
      [],
    );
    expect(accountNeedsCtaAttention(view, DEFAULT_CTA_CONFIG, now).needsAttention).toBe(true);
  });

  it('flags dark structural signals', () => {
    const view = buildAccountView(
      acct({
        assignedCSE: null,
        csCoverage: 'Digital',
        salesforceSlackChannelUrl: null,
        cseSentimentCommentary: null,
        cseSentimentCommentaryLastUpdated: null,
        workshops: [],
        recentMeetings: [],
        engagementMinutes30d: 0,
      }),
      [],
    );
    expect(accountNeedsCtaAttention(view, DEFAULT_CTA_CONFIG, now).needsAttention).toBe(true);
  });

  it('flags Green accounts with partial dark signals', () => {
    const view = buildAccountView(
      acct({
        cseSentiment: 'Green',
        engagementMinutes30d: 3,
        workshops: [],
        recentMeetings: [],
        cseSentimentCommentaryLastUpdated: null,
      }),
      [],
    );
    const result = accountNeedsCtaAttention(view, DEFAULT_CTA_CONFIG, now);
    expect(result.needsAttention).toBe(true);
    expect(result.reasons.some((r) => /dark risk signals|engagio|commentary/i.test(r))).toBe(true);
  });
});

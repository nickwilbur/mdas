import { describe, expect, it } from 'vitest';
import type { AccountView, CanonicalAccount } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { DEFAULT_CTA_CONFIG } from './config.js';
import { dedupKey, isWithinDedupWindow, shouldSuppress } from './suppress.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

function acct(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: '001',
    salesforceAccountId: '001',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: { id: 'ae', name: 'AE' },
    assignedCSE: { id: 'cse', name: 'CSE' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Yellow',
    cseSentimentCommentary: '',
    cseSentimentLastUpdated: '2026-06-10T00:00:00Z',
    cseSentimentCommentaryLastUpdated: '2026-06-10T00:00:00Z',
    cerebroRiskCategory: 'Medium',
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
    allTimeARR: 100_000,
    activeProductLines: [],
    engagementMinutes30d: 5,
    engagementMinutes90d: 20,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [
      {
        source: 'calendar',
        title: 'Sync',
        startTime: '2026-06-14T00:00:00Z',
        attendees: [],
      },
    ],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: null,
    sourceLinks: [],
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function view(accountOverrides: Partial<CanonicalAccount> = {}): AccountView {
  return buildAccountView(acct(accountOverrides), []);
}

describe('shouldSuppress', () => {
  it('suppresses when recent activity + migration/RFP commentary', () => {
    const result = shouldSuppress(
      view({
        cseSentimentCommentary: 'Customer mid-migration to competitor; paused vendor until Q3.',
      }),
      'engagement_risk',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result).toEqual({
      suppressed: true,
      reason: 'Customer mid-migration/RFP — paused vendor activity per commentary',
    });
  });

  it('suppresses when open Gainsight task covers the play theme', () => {
    const result = shouldSuppress(
      view({
        gainsightTasks: [
          { id: 'gs1', title: 'Exec engagement plan', status: 'Open', dueDate: null },
        ],
      }),
      'engagement_risk',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result.suppressed).toBe(true);
    expect(result.reason).toContain('Open Gainsight CTA');
  });

  it('allows confirmed_churn_retro on Confirmed Churn bucket', () => {
    const churnView = buildAccountView(
      acct({
        cseSentiment: 'Confirmed Churn',
        isConfirmedChurn: true,
        churnDate: '2026-06-01',
      }),
      [],
    );
    const result = shouldSuppress(
      churnView,
      'confirmed_churn_retro',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result.suppressed).toBe(false);
  });

  it('suppresses re-engagement plays on Confirmed Churn bucket', () => {
    const churnView = buildAccountView(
      acct({
        cseSentiment: 'Confirmed Churn',
        isConfirmedChurn: true,
        churnDate: '2026-06-01',
      }),
      [],
    );
    const result = shouldSuppress(
      churnView,
      'dark_account',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result).toEqual({
      suppressed: true,
      reason: 'Confirmed churn — retro only',
    });
  });

  it('suppresses risk CTAs when commentary documents an active plan', () => {
    const result = shouldSuppress(
      view({
        cseSentimentCommentary: 'Team is on track with the action plan for renewal.',
      }),
      'utilization_risk',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result).toEqual({
      suppressed: true,
      reason: 'Commentary documents active plan — team aware',
    });
  });

  it('does not suppress data_quality_gap when active plan is documented', () => {
    const result = shouldSuppress(
      view({
        cseSentimentCommentary: 'Actively working the action plan.',
      }),
      'data_quality_gap',
      DEFAULT_CTA_CONFIG,
      NOW,
    );
    expect(result.suppressed).toBe(false);
  });
});

describe('dedupKey', () => {
  it('combines salesforce account id and play type', () => {
    expect(dedupKey('001ABC', 'dark_account')).toBe('001ABC:dark_account');
  });

  it('uses unknown when salesforce id is null', () => {
    expect(dedupKey(null, 'engagement_risk')).toBe('unknown:engagement_risk');
  });
});

describe('isWithinDedupWindow', () => {
  it('returns true inside the window', () => {
    expect(isWithinDedupWindow('2026-06-10T12:00:00Z', 14, NOW)).toBe(true);
  });

  it('returns false outside the window', () => {
    expect(isWithinDedupWindow('2026-05-01T12:00:00Z', 14, NOW)).toBe(false);
  });

  it('returns false for unparseable timestamps', () => {
    expect(isWithinDedupWindow('not-a-date', 14, NOW)).toBe(false);
  });
});

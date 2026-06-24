import { describe, it, expect } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
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
    accountOwner: null,
    assignedCSE: null,
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

describe('shouldSuppress', () => {
  it('suppresses re-engagement when recent activity coincides with migration commentary', () => {
    const view = buildAccountView(
      acct({
        recentMeetings: [
          { source: 'calendar', title: 'Sync', startTime: '2026-06-14T00:00:00Z', attendees: [] },
        ],
        cseSentimentCommentary: 'Customer mid-migration to competitor — paused vendor activity.',
      }),
      [],
    );
    const result = shouldSuppress(view, 'dark_account', DEFAULT_CTA_CONFIG, NOW);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/migration|RFP/i);
  });

  it('suppresses when an open Gainsight task covers the same play theme', () => {
    const view = buildAccountView(
      acct({
        gainsightTasks: [{ id: 'gs1', title: 'Utilization remediation plan', status: 'Open', dueDate: null }],
      }),
      [],
    );
    const result = shouldSuppress(view, 'utilization_risk', DEFAULT_CTA_CONFIG, NOW);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/Gainsight CTA/);
  });

  it('ignores closed Gainsight tasks', () => {
    const view = buildAccountView(
      acct({
        gainsightTasks: [{ id: 'gs1', title: 'Utilization remediation plan', status: 'Closed', dueDate: null }],
      }),
      [],
    );
    expect(shouldSuppress(view, 'utilization_risk', DEFAULT_CTA_CONFIG, NOW).suppressed).toBe(false);
  });

  it('suppresses non-retro plays for confirmed churn accounts', () => {
    const view = buildAccountView(acct({ cseSentiment: 'Confirmed Churn' }), []);
    expect(shouldSuppress(view, 'dark_account', DEFAULT_CTA_CONFIG, NOW).suppressed).toBe(true);
    expect(shouldSuppress(view, 'confirmed_churn_retro', DEFAULT_CTA_CONFIG, NOW).suppressed).toBe(false);
  });

  it('suppresses risk plays when commentary documents an active plan', () => {
    const view = buildAccountView(
      acct({ cseSentimentCommentary: 'We have an action plan and are on track with remediation.' }),
      [],
    );
    expect(shouldSuppress(view, 'engagement_risk', DEFAULT_CTA_CONFIG, NOW).suppressed).toBe(true);
    expect(shouldSuppress(view, 'data_quality_gap', DEFAULT_CTA_CONFIG, NOW).suppressed).toBe(false);
  });
});

describe('dedupKey', () => {
  it('combines salesforce account id and play type', () => {
    expect(dedupKey('001ABC', 'dark_account')).toBe('001ABC:dark_account');
    expect(dedupKey(null, 'dark_account')).toBe('unknown:dark_account');
  });
});

describe('isWithinDedupWindow', () => {
  it('returns false for invalid timestamps', () => {
    expect(isWithinDedupWindow('not-a-date', 14, NOW)).toBe(false);
  });

  it('returns true inside the dedup window', () => {
    expect(isWithinDedupWindow('2026-06-10T00:00:00Z', 14, NOW)).toBe(true);
    expect(isWithinDedupWindow('2026-05-01T00:00:00Z', 14, NOW)).toBe(false);
  });
});

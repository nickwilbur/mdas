import { describe, it, expect } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import {
  daysSinceLastActivity,
  hasRecentActivity,
  isWithinDays,
  lastCustomerActivityMs,
} from './activity.js';

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
    ...overrides,
  };
}

describe('lastCustomerActivityMs', () => {
  it('returns the most recent timestamp across meetings, workshops, and sentiment fields', () => {
    const account = acct({
      recentMeetings: [{ source: 'calendar', title: 'Sync', startTime: '2026-06-10T00:00:00Z', attendees: [] }],
      workshops: [{ id: 'w1', engagementType: 'QBR', status: 'Complete', workshopDate: '2026-06-14T00:00:00Z' }],
      cseSentimentLastUpdated: '2026-06-12T00:00:00Z',
      cseSentimentCommentaryLastUpdated: '2026-06-15T00:00:00Z',
    });
    expect(lastCustomerActivityMs(account, NOW)).toBe(Date.parse('2026-06-15T00:00:00Z'));
  });

  it('ignores invalid meeting and workshop dates', () => {
    const account = acct({
      recentMeetings: [{ source: 'calendar', title: 'Bad', startTime: 'not-a-date', attendees: [] }],
      workshops: [{ id: 'w1', engagementType: 'QBR', status: 'Complete', workshopDate: '' }],
      cseSentimentCommentaryLastUpdated: '2026-06-01T00:00:00Z',
    });
    expect(lastCustomerActivityMs(account, NOW)).toBe(Date.parse('2026-06-01T00:00:00Z'));
  });
});

describe('daysSinceLastActivity', () => {
  it('returns null when no finite activity timestamp exists', () => {
    expect(daysSinceLastActivity(acct(), NOW)).toBeNull();
  });

  it('floors whole days since the latest activity', () => {
    const account = acct({
      cseSentimentCommentaryLastUpdated: '2026-06-14T18:00:00Z',
    });
    expect(daysSinceLastActivity(account, NOW)).toBe(1);
  });
});

describe('hasRecentActivity', () => {
  it('is true when activity falls inside the lookback window', () => {
    const account = acct({
      recentMeetings: [{ source: 'calendar', title: 'Sync', startTime: '2026-06-14T00:00:00Z', attendees: [] }],
    });
    expect(hasRecentActivity(account, 7, NOW)).toBe(true);
    expect(hasRecentActivity(account, 1, NOW)).toBe(false);
  });
});

describe('isWithinDays', () => {
  it('returns false for missing or invalid ISO timestamps', () => {
    expect(isWithinDays(null, 7, NOW)).toBe(false);
    expect(isWithinDays(undefined, 7, NOW)).toBe(false);
    expect(isWithinDays('invalid', 7, NOW)).toBe(false);
  });

  it('returns true when the timestamp is within the day window', () => {
    expect(isWithinDays('2026-06-15T00:00:00Z', 2, NOW)).toBe(true);
    expect(isWithinDays('2026-06-01T00:00:00Z', 7, NOW)).toBe(false);
  });
});

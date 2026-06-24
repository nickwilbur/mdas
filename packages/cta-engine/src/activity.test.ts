import { describe, expect, it } from 'vitest';
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
    accountOwner: { id: 'ae', name: 'AE' },
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
    allTimeARR: 100_000,
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
    lastUpdated: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

describe('lastCustomerActivityMs', () => {
  it('returns the most recent timestamp across meetings, workshops, and sentiment', () => {
    const account = acct({
      recentMeetings: [
        { source: 'calendar', title: 'Old', startTime: '2026-06-01T00:00:00Z', attendees: [] },
        { source: 'calendar', title: 'New', startTime: '2026-06-14T00:00:00Z', attendees: [] },
      ],
      workshops: [
        { id: 'w1', engagementType: 'QBR', status: 'Complete', workshopDate: '2026-06-10T00:00:00Z' },
      ],
      cseSentimentCommentaryLastUpdated: '2026-06-12T00:00:00Z',
    });
    expect(lastCustomerActivityMs(account, NOW)).toBe(Date.parse('2026-06-14T00:00:00Z'));
  });

  it('ignores invalid meeting timestamps', () => {
    const account = acct({
      recentMeetings: [
        { source: 'calendar', title: 'Bad', startTime: 'not-a-date', attendees: [] },
      ],
      cseSentimentLastUpdated: '2026-06-10T00:00:00Z',
    });
    expect(lastCustomerActivityMs(account, NOW)).toBe(Date.parse('2026-06-10T00:00:00Z'));
  });
});

describe('daysSinceLastActivity', () => {
  it('returns null when no activity timestamps exist', () => {
    expect(daysSinceLastActivity(acct(), NOW)).toBeNull();
  });

  it('floors whole days since the latest activity', () => {
    const account = acct({
      recentMeetings: [
        { source: 'calendar', title: 'Sync', startTime: '2026-06-14T12:00:00Z', attendees: [] },
      ],
    });
    expect(daysSinceLastActivity(account, NOW)).toBe(2);
  });
});

describe('hasRecentActivity', () => {
  it('returns true when activity falls inside the window', () => {
    const account = acct({
      recentMeetings: [
        { source: 'calendar', title: 'Sync', startTime: '2026-06-14T00:00:00Z', attendees: [] },
      ],
    });
    expect(hasRecentActivity(account, 7, NOW)).toBe(true);
  });

  it('returns false when the latest activity is older than the window', () => {
    const account = acct({
      recentMeetings: [
        { source: 'calendar', title: 'Sync', startTime: '2026-05-01T00:00:00Z', attendees: [] },
      ],
    });
    expect(hasRecentActivity(account, 7, NOW)).toBe(false);
  });
});

describe('isWithinDays', () => {
  it('returns false for nullish or invalid ISO strings', () => {
    expect(isWithinDays(null, 7, NOW)).toBe(false);
    expect(isWithinDays(undefined, 7, NOW)).toBe(false);
    expect(isWithinDays('bad-date', 7, NOW)).toBe(false);
  });

  it('returns true when the timestamp is within the day window', () => {
    expect(isWithinDays('2026-06-14T00:00:00Z', 7, NOW)).toBe(true);
  });
});

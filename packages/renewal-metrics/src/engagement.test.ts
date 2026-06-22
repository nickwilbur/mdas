import { describe, expect, it } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import {
  daysSinceLastCustomerEngagement,
  daysSinceLastSlackChannelUpdate,
  isAutomatedSlackMessage,
  isMarketingEmail,
  lastHumanCustomerEngagement,
  lastHumanSlackPost,
} from './engagement.js';

const AS_OF = '2026-06-16T12:00:00.000Z';

function mkAccount(over: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: 'A1',
    salesforceAccountId: 'SF1',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: null,
    assignedCSE: null,
    csCoverage: null,
    franchise: 'Expand 3',
    cseSentiment: null,
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
    allTimeARR: null,
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
    lastUpdated: AS_OF,
    ...over,
  };
}

describe('isAutomatedSlackMessage', () => {
  it('flags join and app-added system messages', () => {
    expect(isAutomatedSlackMessage('Alice joined #cust-acme', null)).toBe(true);
    expect(isAutomatedSlackMessage('Google Calendar', 'Event starting soon')).toBe(true);
    expect(isAutomatedSlackMessage('Zoom', 'Meeting started')).toBe(true);
  });

  it('allows human-authored posts but flags Account Pulse bot summaries', () => {
    expect(
      isAutomatedSlackMessage('Slack: cust-kustomer channel', 'Thanks — we will review the renewal terms this week.'),
    ).toBe(false);
    expect(
      isAutomatedSlackMessage(
        'Account Pulse APP',
        "Here's what's happening on the account this week — CFO blocking multi-year renewal.",
      ),
    ).toBe(true);
  });
});

describe('isMarketingEmail', () => {
  it('flags bulk marketing mail', () => {
    expect(isMarketingEmail('Zuora Product Newsletter — June', 'Click unsubscribe')).toBe(true);
  });

  it('allows staircase summaries and AE outreach', () => {
    expect(isMarketingEmail('Staircase weekly summary — Acme', 'Sentiment down 4 pts')).toBe(
      false,
    );
    expect(isMarketingEmail('Re: renewal planning', 'Following up on our QBR action items')).toBe(
      false,
    );
  });
});

describe('lastHumanSlackPost', () => {
  it('returns days since the most recent human Slack post for the mapped channel', () => {
    const account = mkAccount({
      salesforceSlackChannelUrl: 'https://zuora.slack.com/archives/C0123ABCD',
      recentMeetings: [
        {
          source: 'calendar',
          title: 'Slack: cust-acme channel',
          startTime: '2026-06-01T00:00:00.000Z',
          attendees: [],
          summary: 'Customer flagged an escalation around invoice posting.',
          url: 'https://zuora.slack.com/archives/C0123ABCD/p123',
        },
      ],
    });
    const touch = lastHumanSlackPost(account, AS_OF);
    expect(touch?.daysSince).toBe(15);
    expect(touch?.summary).toContain('escalation');
  });

  it('ignores bot join and app-added messages', () => {
    const account = mkAccount({
      salesforceSlackChannelUrl: 'https://zuora.slack.com/archives/C0123ABCD',
      recentMeetings: [
        {
          source: 'calendar',
          title: 'Slack: cust-acme channel',
          startTime: '2026-06-14T00:00:00.000Z',
          attendees: [],
          summary: 'Alice joined #cust-acme',
          url: 'https://zuora.slack.com/archives/C0123ABCD/p999',
        },
        {
          source: 'calendar',
          title: 'Slack: cust-acme channel',
          startTime: '2026-06-01T00:00:00.000Z',
          attendees: [],
          summary: 'Thanks — we will review the renewal terms this week.',
          url: 'https://zuora.slack.com/archives/C0123ABCD/p123',
        },
      ],
    });
    expect(daysSinceLastSlackChannelUpdate(account, AS_OF)).toBe(15);
    expect(lastHumanSlackPost(account, AS_OF)?.summary).toContain('renewal terms');
  });

  it('returns null when no human Slack evidence is indexed', () => {
    expect(lastHumanSlackPost(mkAccount(), AS_OF)).toBeNull();
  });
});

describe('lastHumanCustomerEngagement', () => {
  it('returns days since the latest workshop or calendar meeting', () => {
    const account = mkAccount({
      workshops: [
        {
          id: 'W1',
          engagementType: 'QBR',
          status: 'Completed',
          workshopDate: '2026-06-10',
        },
      ],
    });
    expect(daysSinceLastCustomerEngagement(account, AS_OF)).toBe(6);
    expect(lastHumanCustomerEngagement(account, AS_OF)?.title).toContain('QBR');
  });

  it('excludes marketing email and slack from engagement', () => {
    const account = mkAccount({
      recentMeetings: [
        {
          source: 'staircase',
          title: 'Zuora Product Newsletter — June',
          startTime: '2026-06-15T00:00:00.000Z',
          attendees: [],
          summary: 'Click unsubscribe to opt out.',
          url: 'https://mail.google.com/mail/u/0/#all/marketing',
        },
        {
          source: 'calendar',
          title: 'Slack: cust-acme channel',
          startTime: '2026-06-14T00:00:00.000Z',
          attendees: [],
          summary: 'Human slack post',
          url: 'https://zuora.slack.com/archives/C1/p1',
        },
        {
          source: 'calendar',
          title: 'Acme — FY27 EBR',
          startTime: '2026-06-10T00:00:00.000Z',
          attendees: ['ae@zuora.com'],
          summary: 'Executive business review with customer leadership.',
          url: 'https://calendar.google.com/event/1',
        },
      ],
    });
    expect(daysSinceLastCustomerEngagement(account, AS_OF)).toBe(6);
    expect(lastHumanCustomerEngagement(account, AS_OF)?.title).toBe('Acme — FY27 EBR');
  });
});

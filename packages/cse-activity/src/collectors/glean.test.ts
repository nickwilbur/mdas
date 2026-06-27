import { describe, it, expect } from 'vitest';
import type { AccountView } from '@mdas/canonical';
import { resolveReportingWindow } from '../window.js';
import {
  assessGleanMcpFreshness,
  collectGleanActivitiesFromViews,
  gleanMcpNeedsRefreshWarning,
  meetingToGleanActivity,
} from './glean.js';

function view(accountId: string, franchise = 'Expand 3'): AccountView {
  return {
    account: {
      accountId,
      accountName: accountId,
      franchise,
      assignedCSE: { id: 'U1', name: 'Kiran Rajan' },
      recentMeetings: [],
      sourceLinks: [],
      lastUpdated: new Date().toISOString(),
    },
    bucket: 'Healthy',
    atrUSD: 0,
  } as AccountView;
}

describe('assessGleanMcpFreshness', () => {
  it('counts fresh, stale, and never-enriched Expand 3 accounts (7-day window)', () => {
    const fresh = new Date().toISOString();
    const views = [
      view('fresh'),
      view('stale'),
      view('never'),
      view('other', 'Core'),
    ];
    views[0]!.account.lastFetchedFromSource = { 'glean-mcp': fresh };
    views[1]!.account.lastFetchedFromSource = { 'glean-mcp': '2020-01-01T00:00:00.000Z' };

    const summary = assessGleanMcpFreshness(views);
    expect(summary).toMatchObject({
      expand3Total: 3,
      freshCount: 1,
      staleCount: 1,
      neverEnrichedCount: 1,
    });
  });

  it('does not warn when glean-mcp ran on latest refresh but some accounts lack hits', () => {
    const startedAt = new Date().toISOString();
    const views = [
      view('with-hits'),
      view('empty'),
    ];
    views[0]!.account.lastFetchedFromSource = { 'glean-mcp': startedAt };
    views[0]!.account.recentMeetings = [
      {
        source: 'calendar',
        title: 'QBR',
        startTime: startedAt,
        attendees: [],
        summary: 'ok',
        url: 'u',
      },
    ];
    views[1]!.account.lastFetchedFromSource = { 'glean-mcp': startedAt };

    const summary = assessGleanMcpFreshness(views, {
      latestRefresh: { startedAt, gleanMcpRan: true },
    });
    expect(gleanMcpNeedsRefreshWarning(summary)).toBe(false);
    expect(summary.emptyAfterRefreshCount).toBe(1);
  });
});

describe('collectGleanActivitiesFromViews', () => {
  it('collects in-window calendar meetings as customer-facing', () => {
    const window = resolveReportingWindow({ anchor: new Date('2026-06-26T23:00:00.000Z') });
    const v = view('acct-1');
    v.account.recentMeetings = [
      {
        source: 'calendar',
        title: 'QBR with customer',
        startTime: window.windowEnd,
        attendees: ['kiran.rajan@zuora.com'],
        summary: 'Discussed product roadmap',
        url: 'https://calendar.google.com/event/1',
      },
    ];
    const { activities } = collectGleanActivitiesFromViews({ views: [v], window });
    expect(activities).toHaveLength(1);
    expect(activities[0]!.customerFacing).toBe(true);
    expect(activities[0]!.category).toBe('executive_engagement');
  });

  it('collects slack source links from glean enrichment', () => {
    const window = resolveReportingWindow({ anchor: new Date('2026-06-26T23:00:00.000Z') });
    const v = view('acct-2');
    v.account.lastFetchedFromSource = { 'glean-mcp': window.windowEnd };
    v.account.sourceLinks = [
      {
        source: 'slack',
        label: 'Customer thread',
        url: 'https://zuora.enterprise.slack.com/archives/C123/p1',
      },
    ];
    const { activities } = collectGleanActivitiesFromViews({ views: [v], window });
    expect(activities).toHaveLength(1);
    expect(activities[0]!.source).toBe('glean_slack');
    expect(activities[0]!.customerFacing).toBe(true);
  });
});

describe('meetingToGleanActivity', () => {
  it('skips meetings outside the reporting window', () => {
    const window = resolveReportingWindow({ anchor: new Date('2026-06-26T23:00:00.000Z') });
    const act = meetingToGleanActivity(
      view('acct-3'),
      {
        source: 'calendar',
        title: 'Old meeting',
        startTime: '2020-01-01T12:00:00.000Z',
        summary: null,
        url: null,
      },
      window,
    );
    expect(act).toBeNull();
  });
});

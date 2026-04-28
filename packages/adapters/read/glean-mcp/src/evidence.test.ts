import { describe, expect, it, vi } from 'vitest';
import { applyContextAndEvidenceToAccount, fetchAccountEvidence } from './evidence.js';
import type { CanonicalAccount } from '@mdas/canonical';
import type { GleanClient, GleanDocument, GleanSearchOptions } from '../../_shared/src/glean.js';

const NOW = new Date('2026-04-28T18:00:00.000Z');

/**
 * Build a stubbed GleanClient that dispatches per-datasource fixtures.
 * The evidence module issues one search per datasource; the stub
 * inspects opts.datasources[0] and returns the matching fixture.
 */
function makeClientByDatasource(
  fixtures: Record<string, GleanDocument[]>,
): GleanClient {
  return {
    searchAll: vi.fn(async (opts: GleanSearchOptions) => {
      const ds = opts.datasources?.[0] ?? '';
      return fixtures[ds] ?? [];
    }),
    search: vi.fn(),
    getDocuments: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as GleanClient;
}

const RECENT = '2026-04-21T18:00:00.000Z'; // 7 days before NOW
const STALE = '2025-08-01T18:00:00.000Z'; // ~9 months before NOW

describe('fetchAccountEvidence', () => {
  it('aggregates across calendar, slack, gmail and tags each MeetingSummary correctly', async () => {
    const client = makeClientByDatasource({
      googlecalendar: [
        {
          title: 'Acme — FY27 EBR',
          url: 'https://calendar.google.com/event/1',
          updateTime: RECENT,
          matchingFilters: { participants: ['nick@zuora.com', 'cto@acme.com'] },
          snippets: ['EBR with the Acme team to plan FY27 renewals.'],
          datasource: 'googlecalendar',
        },
      ],
      slack: [
        {
          title: 'Slack: cust-acme channel',
          url: 'https://teamzuora.slack.com/archives/CXX/p1',
          updateTime: RECENT,
          snippets: ['Customer flagged an escalation around invoice posting.'],
          datasource: 'slack',
        },
      ],
      gmail: [
        {
          title: 'Staircase weekly summary — Acme',
          url: 'https://mail.google.com/mail/u/0/#all/abc',
          updateTime: RECENT,
          snippets: ['Sentiment trended down 4 points week-over-week.'],
          datasource: 'gmail',
        },
      ],
    });
    const out = await fetchAccountEvidence(
      client,
      { accountId: 'a1', accountName: 'Acme' },
      { recencyDays: 30 },
    );
    expect(out.recentMeetings).toHaveLength(3);
    const buckets = new Set(out.recentMeetings.map((m) => m.source));
    expect(buckets).toEqual(new Set(['calendar', 'staircase']));
    // Calendar bucket includes both googlecalendar and slack (per the
    // SOURCES config — slack maps to "calendar" because the canonical
    // type union doesn't have a dedicated slack bucket today).
    expect(out.recentMeetings.filter((m) => m.source === 'calendar')).toHaveLength(2);
    expect(out.recentMeetings.filter((m) => m.source === 'staircase')).toHaveLength(1);
  });

  it('extracts attendees from the calendar matchingFilters facet', async () => {
    const client = makeClientByDatasource({
      googlecalendar: [
        {
          title: 'Acme sync',
          url: 'https://cal/1',
          updateTime: RECENT,
          matchingFilters: { participants: ['a@x.com', 'b@x.com', 'a@x.com'] }, // dedup
          datasource: 'googlecalendar',
        },
      ],
    });
    const out = await fetchAccountEvidence(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.recentMeetings[0]?.attendees).toEqual(['a@x.com', 'b@x.com']);
  });

  it('drops stale results outside the recency window', async () => {
    const client = makeClientByDatasource({
      googlecalendar: [
        { title: 'Old EBR', url: 'https://cal/old', updateTime: STALE, datasource: 'googlecalendar' },
        { title: 'Fresh EBR', url: 'https://cal/new', updateTime: RECENT, datasource: 'googlecalendar' },
      ],
    });
    const out = await fetchAccountEvidence(
      client,
      { accountId: 'a1', accountName: 'Acme' },
      { recencyDays: 30 },
    );
    const titles = out.recentMeetings.map((m) => m.title);
    expect(titles).toEqual(['Fresh EBR']);
  });

  it('caps results at topNPerSource to avoid noisy accounts blowing out canonical', async () => {
    const cal: GleanDocument[] = Array.from({ length: 8 }, (_v, i) => ({
      title: `Meet ${i}`,
      url: `https://cal/${i}`,
      updateTime: RECENT,
      datasource: 'googlecalendar',
    }));
    const client = makeClientByDatasource({ googlecalendar: cal });
    const out = await fetchAccountEvidence(
      client,
      { accountId: 'a1', accountName: 'Acme' },
      { topNPerSource: 2 },
    );
    expect(
      out.recentMeetings.filter((m) => m.url?.startsWith('https://cal/')),
    ).toHaveLength(2);
  });

  it('survives a single-source failure without losing other sources', async () => {
    const client: GleanClient = {
      searchAll: vi.fn(async (opts: GleanSearchOptions) => {
        const ds = opts.datasources?.[0];
        if (ds === 'gmail') throw new Error('Gmail connector down');
        if (ds === 'googlecalendar') {
          return [
            { title: 'Acme EBR', url: 'https://cal/1', updateTime: RECENT, datasource: 'googlecalendar' },
          ];
        }
        return [];
      }),
      search: vi.fn(),
      getDocuments: vi.fn(),
      healthCheck: vi.fn(),
    } as unknown as GleanClient;

    const out = await fetchAccountEvidence(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.recentMeetings.map((m) => m.url)).toEqual(['https://cal/1']);
  });

  it('emits SourceLinks with the right `source` per datasource', async () => {
    const client = makeClientByDatasource({
      googlecalendar: [{ title: 'cal', url: 'u1', updateTime: RECENT, datasource: 'googlecalendar' }],
      slack: [{ title: 'slk', url: 'u2', updateTime: RECENT, datasource: 'slack' }],
      gmail: [{ title: 'gm', url: 'u3', updateTime: RECENT, datasource: 'gmail' }],
    });
    const out = await fetchAccountEvidence(client, { accountId: 'a1', accountName: 'Acme' });
    const sources = out.sourceLinks.map((sl) => sl.source);
    expect(new Set(sources)).toEqual(new Set(['calendar', 'slack', 'gmail']));
  });
});

describe('applyContextAndEvidenceToAccount', () => {
  it('writes the merged shape onto the patch and stamps glean-mcp freshness', () => {
    const patch: Partial<CanonicalAccount> = { accountId: 'a1' };
    applyContextAndEvidenceToAccount(
      patch,
      {
        accountPlanLinks: [{ title: 'Plan', url: 'u-plan', lastModified: RECENT }],
        sourceLinks: [{ source: 'glean', label: 'Plan', url: 'u-plan' }],
      },
      {
        recentMeetings: [
          {
            source: 'calendar',
            title: 'EBR',
            startTime: RECENT,
            attendees: [],
            summary: 'snippet',
            url: 'u-cal',
          },
        ],
        sourceLinks: [{ source: 'calendar', label: 'EBR', url: 'u-cal' }],
      },
      NOW,
    );
    expect(patch.accountPlanLinks).toHaveLength(1);
    expect(patch.recentMeetings).toHaveLength(1);
    expect(patch.sourceLinks).toHaveLength(2);
    expect(patch.lastFetchedFromSource?.['glean-mcp']).toBe(NOW.toISOString());
  });

  it('skips empty fields and preserves prior lastFetchedFromSource entries', () => {
    const patch: Partial<CanonicalAccount> = {
      accountId: 'a1',
      lastFetchedFromSource: { salesforce: '2026-04-28T17:00:00.000Z' },
    };
    applyContextAndEvidenceToAccount(
      patch,
      { accountPlanLinks: [], sourceLinks: [] },
      { recentMeetings: [], sourceLinks: [] },
      NOW,
    );
    expect(patch.accountPlanLinks).toBeUndefined();
    expect(patch.recentMeetings).toBeUndefined();
    expect(patch.sourceLinks).toBeUndefined();
    expect(patch.lastFetchedFromSource).toEqual({
      salesforce: '2026-04-28T17:00:00.000Z',
      'glean-mcp': NOW.toISOString(),
    });
  });
});

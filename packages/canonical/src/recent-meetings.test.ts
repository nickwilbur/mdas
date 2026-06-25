import { describe, expect, it } from 'vitest';
import { mergeRecentMeetings, MAX_RECENT_MEETINGS } from './recent-meetings.js';

describe('mergeRecentMeetings', () => {
  it('dedupes by URL and keeps newest first', () => {
    const prior = [
      {
        source: 'calendar' as const,
        title: 'Old',
        startTime: '2026-05-01T00:00:00.000Z',
        attendees: [],
        summary: 'prior',
        url: 'https://example.com/old',
      },
    ];
    const next = [
      {
        source: 'calendar' as const,
        title: 'Fresh',
        startTime: '2026-06-05T00:00:00.000Z',
        attendees: [],
        summary: 'new',
        url: 'https://example.com/new',
      },
    ];
    const merged = mergeRecentMeetings(prior, next);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.title).toBe('Fresh');
  });

  it('caps at MAX_RECENT_MEETINGS', () => {
    const many = Array.from({ length: MAX_RECENT_MEETINGS + 10 }, (_v, i) => ({
      source: 'calendar' as const,
      title: `Meet ${i}`,
      startTime: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      attendees: [],
      summary: null,
      url: `https://cal/${i}`,
    }));
    expect(mergeRecentMeetings([], many)).toHaveLength(MAX_RECENT_MEETINGS);
  });
});

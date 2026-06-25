import type { MeetingSummary } from './index.js';

/** Cap merged meeting history on canonical accounts. */
export const MAX_RECENT_MEETINGS = 150;

/** Merge prior + new meetings, deduped by URL, newest first, bounded. */
export function mergeRecentMeetings(
  prior: MeetingSummary[] | undefined,
  next: MeetingSummary[],
): MeetingSummary[] {
  const byUrl = new Map<string, MeetingSummary>();
  for (const meeting of prior ?? []) {
    if (meeting.url) byUrl.set(meeting.url, meeting);
  }
  for (const meeting of next) {
    if (meeting.url) byUrl.set(meeting.url, meeting);
  }
  return [...byUrl.values()]
    .sort((a, b) => Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? ''))
    .slice(0, MAX_RECENT_MEETINGS);
}

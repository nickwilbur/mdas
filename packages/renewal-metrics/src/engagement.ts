import type { CanonicalAccount, MeetingSummary } from '@mdas/canonical';

const DAY = 86_400_000;

/** Latest human touch used for Slack / engagement hover details. */
export interface LastTouchDetail {
  daysSince: number;
  title: string | null;
  summary: string | null;
  url: string | null;
  occurredAt: string | null;
}

const AUTOMATED_SLACK_BODY =
  /\b(has joined|was added|added to|added by|joined #|joined the channel|left #|removed from|archived the channel|set the channel|changed the channel topic|pinned a message|invited @|channel created|app (was )?added|integration (has been )?added|is now a member|uploaded a file|shared an invitation|removed an integration)\b/i;

const AUTOMATED_SLACK_TITLE =
  /^(Slackbot|Google Calendar|Zoom|Gainsight|Jira|Salesforce|HubSpot|Asana|PagerDuty|Datadog|GitHub|Workflow Builder|Account Pulse)/i;

const AUTOMATED_SLACK_APP_POST =
  /\b(here(?:'s| is) what(?:'s| is) happening on the account|account pulse)\b/i;

const MARKETING_EMAIL =
  /\b(unsubscribe|newsletter|marketing@|noreply|no-reply|donotreply|view in browser|email preferences|you(?:'re| are) receiving this|promotional|mailchimp|hubspot|marketo)\b/i;

const MARKETING_EMAIL_TITLE =
  /\b(newsletter|product update|webinar invite|event invitation|monthly digest|weekly digest|fyi: zuora)\b/i;

function parseSlackChannelIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/archives\/([CGD][A-Z0-9]+)/i);
  return match?.[1] ?? null;
}

function daysFromMs(now: number, ts: number): number {
  return Math.floor((now - ts) / DAY);
}

function isAutomatedSlackMessage(title: string, summary: string | null): boolean {
  const blob = `${title} ${summary ?? ''}`;
  if (AUTOMATED_SLACK_BODY.test(blob)) return true;
  if (AUTOMATED_SLACK_TITLE.test(title.trim())) return true;
  if (AUTOMATED_SLACK_APP_POST.test(blob)) return true;
  return false;
}

function isSlackEvidence(meeting: MeetingSummary, channelId: string | null): boolean {
  const url = meeting.url ?? '';
  const title = meeting.title ?? '';
  const matchesChannel = channelId != null && url.includes(channelId);
  const looksLikeSlack =
    url.includes('slack.com') ||
    title.toLowerCase().includes('slack') ||
    /cust-[\w-]+/i.test(title);
  return matchesChannel || looksLikeSlack;
}

function isHumanSlackPost(meeting: MeetingSummary, channelId: string | null): boolean {
  if (!isSlackEvidence(meeting, channelId)) return false;
  return !isAutomatedSlackMessage(meeting.title ?? '', meeting.summary);
}

function isStaircaseSummary(title: string): boolean {
  return /staircase/i.test(title);
}

function isMarketingEmail(title: string, summary: string | null): boolean {
  const blob = `${title} ${summary ?? ''}`;
  if (isStaircaseSummary(title)) return false;
  if (MARKETING_EMAIL.test(blob)) return true;
  if (MARKETING_EMAIL_TITLE.test(title)) return true;
  return false;
}

function isCalendarMeeting(meeting: MeetingSummary): boolean {
  const url = meeting.url ?? '';
  if (url.includes('slack.com')) return false;
  return (
    url.includes('calendar.google') ||
    url.includes('google.com/calendar') ||
    (meeting.source === 'calendar' && !/slack:/i.test(meeting.title ?? ''))
  );
}

/** AE / CSE / leadership touchpoints — excludes Slack and bulk marketing mail. */
function isQualifyingCustomerEngagement(meeting: MeetingSummary): boolean {
  const url = meeting.url ?? '';
  const title = meeting.title ?? '';

  if (url.includes('slack.com') || /slack:/i.test(title)) return false;

  if (meeting.source === 'staircase' || url.includes('mail.google')) {
    return !isMarketingEmail(title, meeting.summary);
  }

  if (isCalendarMeeting(meeting)) return true;
  if (meeting.source === 'zoom') return true;

  return false;
}

/** Most recent real-person Slack post in the mapped customer channel. */
export function lastHumanSlackPost(
  account: CanonicalAccount,
  asOfDate: string,
): LastTouchDetail | null {
  const now = Date.parse(asOfDate);
  if (!Number.isFinite(now)) return null;
  const channelId = parseSlackChannelIdFromUrl(account.salesforceSlackChannelUrl);

  let best: { t: number; meeting: MeetingSummary } | null = null;
  for (const meeting of account.recentMeetings) {
    if (!isHumanSlackPost(meeting, channelId)) continue;
    const t = Date.parse(meeting.startTime ?? '');
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.t) best = { t, meeting };
  }

  if (!best) return null;
  return {
    daysSince: daysFromMs(now, best.t),
    title: best.meeting.title,
    summary: best.meeting.summary,
    url: best.meeting.url,
    occurredAt: best.meeting.startTime,
  };
}

/** Most recent AE / CSE / leadership customer touch (not marketing mail). */
export function lastHumanCustomerEngagement(
  account: CanonicalAccount,
  asOfDate: string,
): LastTouchDetail | null {
  const now = Date.parse(asOfDate);
  if (!Number.isFinite(now)) return null;

  type Candidate = {
    t: number;
    title: string | null;
    summary: string | null;
    url: string | null;
    occurredAt: string | null;
  };
  const candidates: Candidate[] = [];

  for (const meeting of account.recentMeetings) {
    if (!isQualifyingCustomerEngagement(meeting)) continue;
    const t = Date.parse(meeting.startTime ?? '');
    if (!Number.isFinite(t)) continue;
    candidates.push({
      t,
      title: meeting.title,
      summary: meeting.summary,
      url: meeting.url,
      occurredAt: meeting.startTime,
    });
  }

  for (const workshop of account.workshops) {
    const t = Date.parse(workshop.workshopDate ?? '');
    if (!Number.isFinite(t)) continue;
    candidates.push({
      t,
      title: workshop.engagementType ? `${workshop.engagementType} workshop` : 'Workshop',
      summary: workshop.status ? `Status: ${workshop.status}` : null,
      url: null,
      occurredAt: workshop.workshopDate,
    });
  }

  const sentimentTouches: { iso: string | null; label: string; summary: string | null }[] = [
    {
      iso: account.cseSentimentCommentaryLastUpdated,
      label: 'CSE sentiment commentary',
      summary: account.cseSentimentCommentary,
    },
    {
      iso: account.cseSentimentLastUpdated,
      label: 'CSE sentiment update',
      summary: account.cseSentiment,
    },
  ];
  for (const touch of sentimentTouches) {
    if (!touch.iso) continue;
    const t = Date.parse(touch.iso);
    if (!Number.isFinite(t)) continue;
    candidates.push({
      t,
      title: touch.label,
      summary: touch.summary,
      url: null,
      occurredAt: touch.iso,
    });
  }

  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (a.t >= b.t ? a : b));
  return {
    daysSince: daysFromMs(now, best.t),
    title: best.title,
    summary: best.summary,
    url: best.url,
    occurredAt: best.occurredAt,
  };
}

/** Days since the most recent human Slack post in the customer channel. */
export function daysSinceLastSlackChannelUpdate(
  account: CanonicalAccount,
  asOfDate: string,
): number | null {
  return lastHumanSlackPost(account, asOfDate)?.daysSince ?? null;
}

/** Days since the most recent AE / CSE / leadership customer touch. */
export function daysSinceLastCustomerEngagement(
  account: CanonicalAccount,
  asOfDate: string,
): number | null {
  return lastHumanCustomerEngagement(account, asOfDate)?.daysSince ?? null;
}

export {
  isAutomatedSlackMessage,
  isMarketingEmail,
  isQualifyingCustomerEngagement,
};

import type { CanonicalAccount, MeetingSummary } from '@mdas/canonical';
import { isAutomatedSlackMessage, parseSlackUrl, slugifyAccountName } from '@mdas/slack-send';

const DAY = 86_400_000;

/** Latest human touch used for Slack / engagement hover details. */
export interface LastTouchDetail {
  daysSince: number;
  title: string | null;
  summary: string | null;
  url: string | null;
  occurredAt: string | null;
}

const MARKETING_EMAIL =
  /\b(unsubscribe|newsletter|marketing@|noreply|no-reply|donotreply|view in browser|email preferences|you(?:'re| are) receiving this|promotional|mailchimp|hubspot|marketo)\b/i;

const MARKETING_EMAIL_TITLE =
  /\b(newsletter|product update|webinar invite|event invitation|monthly digest|weekly digest|fyi: zuora)\b/i;

const LOGGED_CALL =
  /\b(logged call|log a call|phone call|call with|call —|call -|outbound call|inbound call|gong|chorus)\b/i;

const CONFERENCE =
  /\b(conference|summit|user conference|user group|billing x|zuora day|dreamforce)\b/i;

function daysFromMs(now: number, ts: number): number {
  return Math.floor((now - ts) / DAY);
}

function mappedSlackChannelId(account: CanonicalAccount): string | null {
  return parseSlackUrl(account.salesforceSlackChannelUrl ?? null)?.channelId ?? null;
}

function isSlackEvidence(
  meeting: MeetingSummary,
  channelId: string | null,
  channelSlug: string | null,
): boolean {
  const url = meeting.url ?? '';
  const title = meeting.title ?? '';
  if (channelId) {
    const docChannelId = parseSlackUrl(url)?.channelId;
    if (docChannelId === channelId) return true;
    if (url.includes(channelId)) return true;
    if (channelSlug && title.toLowerCase().includes(channelSlug)) return true;
    return false;
  }
  return (
    url.includes('slack.com') ||
    title.toLowerCase().includes('slack') ||
    /cust-[\w-]+/i.test(title)
  );
}

function isHumanSlackPost(
  meeting: MeetingSummary,
  channelId: string | null,
  channelSlug: string | null,
): boolean {
  if (!isSlackEvidence(meeting, channelId, channelSlug)) return false;
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

function isDocumentedEmail(meeting: MeetingSummary): boolean {
  const url = meeting.url ?? '';
  const title = meeting.title ?? '';
  if (url.includes('slack.com') || /slack:/i.test(title)) return false;
  if (meeting.source === 'staircase' || url.includes('mail.google')) {
    return !isMarketingEmail(title, meeting.summary);
  }
  return false;
}

function isLoggedCallOrSfActivity(meeting: MeetingSummary): boolean {
  const url = meeting.url ?? '';
  const blob = `${meeting.title ?? ''} ${meeting.summary ?? ''} ${url}`;
  if (/salesforce\.com|lightning\.force/i.test(url) && LOGGED_CALL.test(blob)) return true;
  return LOGGED_CALL.test(blob);
}

function isConferenceEvent(meeting: MeetingSummary): boolean {
  return CONFERENCE.test(`${meeting.title ?? ''} ${meeting.summary ?? ''}`);
}

/**
 * AE / CSE / leadership touchpoints with documented customer interaction —
 * meetings, logged calls, customer email, conferences. Excludes Slack,
 * marketing mail, and CSE sentiment field updates.
 */
function isQualifyingCustomerEngagement(meeting: MeetingSummary): boolean {
  const url = meeting.url ?? '';
  const title = meeting.title ?? '';

  if (url.includes('slack.com') || /slack:/i.test(title)) return false;
  if (isDocumentedEmail(meeting)) return true;
  if (isCalendarMeeting(meeting)) return true;
  if (meeting.source === 'zoom') return true;
  if (isLoggedCallOrSfActivity(meeting)) return true;
  if (isConferenceEvent(meeting)) return true;

  return false;
}

/** Most recent real-person Slack post in the mapped customer channel. */
export function lastHumanSlackPost(
  account: CanonicalAccount,
  asOfDate: string,
): LastTouchDetail | null {
  const now = Date.parse(asOfDate);
  if (!Number.isFinite(now)) return null;
  const channelId = mappedSlackChannelId(account);
  const channelSlug = slugifyAccountName(account.accountName);

  let best: { t: number; meeting: MeetingSummary } | null = null;
  for (const meeting of account.recentMeetings) {
    if (!isHumanSlackPost(meeting, channelId, channelSlug)) continue;
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

/** Most recent documented AE / CSE / leadership customer touch. */
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

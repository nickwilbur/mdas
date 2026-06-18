import type { CanonicalAccount } from '@mdas/canonical';

const DAY = 86_400_000;

/** Most recent customer-facing activity timestamp from canonical fields. */
export function lastCustomerActivityMs(
  account: CanonicalAccount,
  now: number,
): number {
  const meetingTimes = account.recentMeetings
    .map((m) => Date.parse(m.startTime ?? ''))
    .filter((t) => Number.isFinite(t));
  const workshopTimes = account.workshops
    .map((w) => Date.parse(w.workshopDate ?? ''))
    .filter((t) => Number.isFinite(t));
  const sentimentT = account.cseSentimentCommentaryLastUpdated
    ? Date.parse(account.cseSentimentCommentaryLastUpdated)
    : Number.NEGATIVE_INFINITY;
  const sentimentFieldT = account.cseSentimentLastUpdated
    ? Date.parse(account.cseSentimentLastUpdated)
    : Number.NEGATIVE_INFINITY;

  return Math.max(
    sentimentT,
    sentimentFieldT,
    ...(meetingTimes.length ? meetingTimes : [Number.NEGATIVE_INFINITY]),
    ...(workshopTimes.length ? workshopTimes : [Number.NEGATIVE_INFINITY]),
  );
}

export function daysSinceLastActivity(
  account: CanonicalAccount,
  now: number,
): number | null {
  const last = lastCustomerActivityMs(account, now);
  if (!Number.isFinite(last)) return null;
  return Math.floor((now - last) / DAY);
}

export function hasRecentActivity(
  account: CanonicalAccount,
  windowDays: number,
  now: number,
): boolean {
  const cutoff = now - windowDays * DAY;
  return lastCustomerActivityMs(account, now) >= cutoff;
}

export function isWithinDays(
  iso: string | null | undefined,
  days: number,
  now: number,
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= days * DAY;
}

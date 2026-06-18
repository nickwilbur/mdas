import type { AccountView } from '@mdas/canonical';
import { nextFutureRenewalOpp } from './scope.js';

const DAY = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(fromMs: number, days: number): string {
  return isoDate(fromMs + days * DAY);
}

/** Deadline is always on or after scanDate (never in the past). */
export function computeCtaDeadline(
  view: AccountView,
  scanDate: string,
  now: number = Date.now(),
): { deadline: string; check_back_date: string } {
  const scanMs = Date.parse(scanDate);
  const minDeadlineMs = scanMs + 7 * DAY;
  const futureRenewal = nextFutureRenewalOpp(view, now);
  const days = view.daysToRenewal;

  let deadlineMs: number;

  if (futureRenewal && days != null && days >= 0 && days <= 30) {
    const renewalMs = Date.parse(futureRenewal.closeDate);
    const target = renewalMs - 7 * DAY;
    deadlineMs = Math.max(target, minDeadlineMs);
  } else if (days != null && days >= 0 && days <= 90) {
    deadlineMs = scanMs + 21 * DAY;
  } else {
    deadlineMs = scanMs + 30 * DAY;
  }

  // Hard floor: never before today
  deadlineMs = Math.max(deadlineMs, now + DAY);

  const checkBackMs = Math.max(scanMs, deadlineMs - 7 * DAY);

  return {
    deadline: isoDate(deadlineMs),
    check_back_date: isoDate(checkBackMs),
  };
}

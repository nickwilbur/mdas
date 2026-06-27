import type { ReportingWindow } from './types.js';

const DENVER = 'America/Denver';

function formatDateInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseTimeParts(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return { hour: h ?? 17, minute: m ?? 0 };
}

/** Resolve the Friday EOD reporting window ending at the most recent Friday 5pm (or anchor). */
export function resolveReportingWindow(opts: {
  timezone?: string;
  fridayEodTime?: string;
  anchor?: Date;
}): ReportingWindow {
  const timezone = opts.timezone ?? DENVER;
  const { hour, minute } = parseTimeParts(opts.fridayEodTime ?? '17:00');
  const anchor = opts.anchor ?? new Date();

  // Walk back to the most recent Friday at EOD in the target timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(anchor);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDow = dayMap[weekday.slice(0, 3)] ?? 5;

  let daysBack = (currentDow - 5 + 7) % 7;
  const currentHour = Number(get('hour'));
  const currentMinute = Number(get('minute'));
  if (daysBack === 0 && (currentHour < hour || (currentHour === hour && currentMinute < minute))) {
    daysBack = 7;
  }

  const endLocal = new Date(anchor.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const startLocal = new Date(endLocal.getTime() - 7 * 24 * 60 * 60 * 1000);

  const snapshotDate = formatDateInTz(endLocal, timezone);

  return {
    snapshotDate,
    windowStart: startLocal.toISOString(),
    windowEnd: endLocal.toISOString(),
    timezone,
  };
}

export function isInWindow(iso: string, window: ReportingWindow): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(window.windowStart) && t <= Date.parse(window.windowEnd);
}

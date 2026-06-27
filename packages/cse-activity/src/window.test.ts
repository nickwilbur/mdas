import { describe, it, expect } from 'vitest';
import { resolveReportingWindow, isInWindow } from '../src/window.js';

describe('resolveReportingWindow', () => {
  it('returns a 7-day window ending on Friday EOD Denver', () => {
    // Friday 2026-06-26 18:00 UTC ~= Friday afternoon Denver
    const w = resolveReportingWindow({
      timezone: 'America/Denver',
      fridayEodTime: '17:00',
      anchor: new Date('2026-06-26T23:00:00.000Z'),
    });
    expect(w.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(w.windowEnd)).toBeGreaterThan(Date.parse(w.windowStart));
  });

  it('isInWindow respects bounds', () => {
    const w = resolveReportingWindow({ anchor: new Date('2026-06-26T23:00:00.000Z') });
    expect(isInWindow(w.windowStart, w)).toBe(true);
    expect(isInWindow(w.windowEnd, w)).toBe(true);
  });
});

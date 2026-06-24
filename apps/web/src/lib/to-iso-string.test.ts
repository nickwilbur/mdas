import { describe, expect, it } from 'vitest';
import { toIsoString } from './to-iso-string';

describe('toIsoString', () => {
  it('converts pg-hydrated Date objects to ISO (regression: started_at.slice is not a function)', () => {
    const d = new Date('2026-05-20T14:30:00.000Z');
    expect(toIsoString(d)).toBe('2026-05-20T14:30:00.000Z');
    expect(toIsoString(d).slice(0, 10)).toBe('2026-05-20');
  });

  it('normalizes ISO strings for safe calendar-day slicing', () => {
    expect(toIsoString('2026-05-20T14:30:00.000Z').slice(0, 10)).toBe('2026-05-20');
  });

  it('converts epoch milliseconds', () => {
    const ms = Date.parse('2026-05-20T14:30:00.000Z');
    expect(toIsoString(ms)).toBe('2026-05-20T14:30:00.000Z');
  });

  it('passes through unparseable strings without throwing', () => {
    expect(toIsoString('not-a-date')).toBe('not-a-date');
  });

  it('falls back to now for nullish input instead of throwing', () => {
    const before = Date.now();
    const iso = toIsoString(undefined);
    const after = Date.now();
    const parsed = Date.parse(iso);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

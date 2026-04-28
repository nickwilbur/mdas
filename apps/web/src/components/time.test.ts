import { describe, expect, it } from 'vitest';
import { isStale, relativeTimeLabel, STALE_AFTER_MS } from './time.js';

const NOW = new Date('2026-04-28T18:00:00Z');

describe('relativeTimeLabel', () => {
  it('returns em-dash for null/undefined/empty', () => {
    expect(relativeTimeLabel(null, NOW)).toBe('—');
    expect(relativeTimeLabel(undefined, NOW)).toBe('—');
    expect(relativeTimeLabel('', NOW)).toBe('—');
  });

  it('returns em-dash for an unparseable timestamp', () => {
    expect(relativeTimeLabel('not a date', NOW)).toBe('—');
  });

  it('says "just now" when less than 1 minute has elapsed', () => {
    expect(relativeTimeLabel('2026-04-28T17:59:30Z', NOW)).toBe('just now');
    expect(relativeTimeLabel('2026-04-28T18:00:00Z', NOW)).toBe('just now');
  });

  it('uses minute granularity inside the first hour', () => {
    expect(relativeTimeLabel('2026-04-28T17:55:00Z', NOW)).toBe('5m ago');
    expect(relativeTimeLabel('2026-04-28T17:01:00Z', NOW)).toBe('59m ago');
  });

  it('uses hour granularity inside the first day', () => {
    expect(relativeTimeLabel('2026-04-28T15:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTimeLabel('2026-04-27T19:00:00Z', NOW)).toBe('23h ago');
  });

  it('says "yesterday" at the 1-day mark', () => {
    expect(relativeTimeLabel('2026-04-27T17:00:00Z', NOW)).toBe('yesterday');
  });

  it('uses day granularity from 2-29 days', () => {
    expect(relativeTimeLabel('2026-04-25T18:00:00Z', NOW)).toBe('3d ago');
    expect(relativeTimeLabel('2026-04-01T18:00:00Z', NOW)).toBe('27d ago');
  });

  it('falls back to a locale date past 30 days', () => {
    const out = relativeTimeLabel('2026-01-01T00:00:00Z', NOW);
    expect(out).not.toMatch(/ago/);
    expect(out).not.toBe('—');
  });

  it('handles future timestamps without negative-counting', () => {
    expect(relativeTimeLabel('2026-04-28T19:00:00Z', NOW)).toBe('in the future');
  });
});

describe('isStale', () => {
  it('returns false for fresh timestamps under the 7d threshold', () => {
    expect(isStale('2026-04-28T17:55:00Z', NOW)).toBe(false);
    expect(isStale('2026-04-22T18:00:01Z', NOW)).toBe(false);
  });

  it('returns true past the 7d threshold', () => {
    expect(isStale('2026-04-21T17:59:00Z', NOW)).toBe(true);
    expect(isStale('2026-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('matches the documented STALE_AFTER_MS constant exactly', () => {
    const exactlyAtBoundary = new Date(NOW.getTime() - STALE_AFTER_MS).toISOString();
    expect(isStale(exactlyAtBoundary, NOW)).toBe(false); // strict >, not >=
    const oneMsPast = new Date(NOW.getTime() - STALE_AFTER_MS - 1).toISOString();
    expect(isStale(oneMsPast, NOW)).toBe(true);
  });
});

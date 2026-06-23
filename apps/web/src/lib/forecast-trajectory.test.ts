import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { toIsoString } from './forecast-trajectory';

describe('toIsoString', () => {
  it('converts Date instances from pg hydration', () => {
    const d = new Date('2026-06-16T14:30:00.000Z');
    expect(toIsoString(d)).toBe('2026-06-16T14:30:00.000Z');
    expect(toIsoString(d).slice(0, 10)).toBe('2026-06-16');
  });

  it('passes through valid ISO strings', () => {
    expect(toIsoString('2026-06-16T14:30:00.000Z')).toBe('2026-06-16T14:30:00.000Z');
  });

  it('normalizes parseable date strings', () => {
    const out = toIsoString('2026-06-16');
    expect(out.slice(0, 10)).toBe('2026-06-16');
  });

  it('converts epoch milliseconds', () => {
    const ms = Date.parse('2026-06-16T08:00:00.000Z');
    expect(toIsoString(ms)).toBe('2026-06-16T08:00:00.000Z');
  });
});

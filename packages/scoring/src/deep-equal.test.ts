// Tests for deepEqual — replaces the JSON.stringify shortcut used by
// the WoW diff. Audit ref: F-15.
import { describe, expect, it } from 'vitest';
import { deepEqual } from './deep-equal.js';

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it('returns false across primitive types', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('treats NaN === NaN', () => {
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('compares plain objects regardless of key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    // The bug fix that justified PR-B2: a real prior diff fired
    // spurious WoW events when an adapter happened to rewrite object
    // keys in a different order.
  });

  it('distinguishes missing key from explicit undefined', () => {
    // JSON.stringify treats these the same; deepEqual does not.
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('compares arrays by element', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it('treats Dates with the same time as equal', () => {
    const d1 = new Date('2026-04-28T12:00:00Z');
    const d2 = new Date('2026-04-28T12:00:00Z');
    expect(deepEqual(d1, d2)).toBe(true);
    expect(deepEqual(d1, new Date('2026-04-28T12:00:01Z'))).toBe(false);
  });

  it('distinguishes nested differences', () => {
    expect(
      deepEqual(
        { account: { name: 'A', tags: ['x', 'y'] } },
        { account: { name: 'A', tags: ['x', 'y'] } },
      ),
    ).toBe(true);
    expect(
      deepEqual(
        { account: { name: 'A', tags: ['x', 'y'] } },
        { account: { name: 'A', tags: ['x', 'z'] } },
      ),
    ).toBe(false);
  });

  it('rejects when one side is null and the other is an object', () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({ a: 1 }, null)).toBe(false);
  });

  it('does NOT consider key-reordered objects as a change (regression for F-15)', () => {
    // Concrete shape derived from a Cerebro risk record.
    const a = {
      utilizationRisk: true,
      engagementRisk: false,
      shareRisk: true,
    };
    const b = {
      shareRisk: true,
      utilizationRisk: true,
      engagementRisk: false,
    };
    expect(deepEqual(a, b)).toBe(true);
  });
});

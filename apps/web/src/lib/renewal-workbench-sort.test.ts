import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENEWAL_WORKBENCH_SORT,
  normalizeRenewalWorkbenchSort,
  renewalWorkbenchSortSerializer,
} from './renewal-workbench-sort';

describe('normalizeRenewalWorkbenchSort', () => {
  it('returns default when input is nullish or not an object', () => {
    expect(normalizeRenewalWorkbenchSort(null)).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
    expect(normalizeRenewalWorkbenchSort(undefined)).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
    expect(normalizeRenewalWorkbenchSort('atr')).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
  });

  it('accepts valid field and direction', () => {
    expect(
      normalizeRenewalWorkbenchSort({ field: 'renewalDate', direction: 'asc' }),
    ).toEqual({ field: 'renewalDate', direction: 'asc' });
  });

  it('rejects unknown fields and invalid directions', () => {
    expect(
      normalizeRenewalWorkbenchSort({ field: 'not-a-column', direction: 'sideways' }),
    ).toEqual({ field: 'atr', direction: 'desc' });
  });
});

describe('renewalWorkbenchSortSerializer', () => {
  it('round-trips valid sort state', () => {
    const sort = { field: 'health' as const, direction: 'asc' as const };
    const restored = renewalWorkbenchSortSerializer.deserialize(
      renewalWorkbenchSortSerializer.serialize(sort),
    );
    expect(restored).toEqual(sort);
  });

  it('sanitizes corrupted localStorage payloads', () => {
    const restored = renewalWorkbenchSortSerializer.deserialize(
      JSON.stringify({ field: 'bogus', direction: 'up' }),
    );
    expect(restored).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
  });
});

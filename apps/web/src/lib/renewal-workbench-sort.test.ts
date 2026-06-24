import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENEWAL_WORKBENCH_SORT,
  normalizeRenewalWorkbenchSort,
  renewalWorkbenchSortSerializer,
} from './renewal-workbench-sort';

describe('normalizeRenewalWorkbenchSort', () => {
  it('returns default sort for nullish or non-object input', () => {
    expect(normalizeRenewalWorkbenchSort(null)).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
    expect(normalizeRenewalWorkbenchSort(undefined)).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
    expect(normalizeRenewalWorkbenchSort('atr')).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
  });

  it('rejects unknown fields and invalid directions', () => {
    expect(
      normalizeRenewalWorkbenchSort({ field: 'not-a-column', direction: 'sideways' }),
    ).toEqual({ field: 'atr', direction: 'desc' });
  });

  it('preserves valid field and direction', () => {
    expect(
      normalizeRenewalWorkbenchSort({ field: 'renewalDate', direction: 'asc' }),
    ).toEqual({ field: 'renewalDate', direction: 'asc' });
  });
});

describe('renewalWorkbenchSortSerializer', () => {
  it('round-trips valid sort state through JSON', () => {
    const sort = { field: 'customerEngagement' as const, direction: 'asc' as const };
    const restored = renewalWorkbenchSortSerializer.deserialize(
      renewalWorkbenchSortSerializer.serialize(sort),
    );
    expect(restored).toEqual(sort);
  });

  it('falls back to defaults when deserializing corrupted localStorage', () => {
    expect(
      renewalWorkbenchSortSerializer.deserialize('{"field":"bogus","direction":"up"}'),
    ).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
  });
});

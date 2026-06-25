import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENEWAL_WORKBENCH_SORT,
  normalizeRenewalWorkbenchSort,
  renewalWorkbenchSortSerializer,
} from './renewal-workbench-sort';

describe('normalizeRenewalWorkbenchSort', () => {
  it('returns defaults for nullish or non-object input', () => {
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
      normalizeRenewalWorkbenchSort({ field: 'bogus', direction: 'sideways' }),
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

  it('falls back to defaults for corrupted persisted JSON', () => {
    expect(
      renewalWorkbenchSortSerializer.deserialize('{"field":"nope"}'),
    ).toEqual(DEFAULT_RENEWAL_WORKBENCH_SORT);
  });
});

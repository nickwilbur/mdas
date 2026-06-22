import { describe, expect, it } from 'vitest';
import {
  bucketQuarterKeys,
  effectiveFiscalHistoryStartKey,
  FISCAL_HISTORY_START_KEY,
  FISCAL_QUARTER_FORWARD_COUNT,
  FISCAL_QUARTER_PROSPECTIVE_COUNT,
  FISCAL_QUARTER_RETROSPECTIVE_COUNT,
  fiscalOpportunityCloseDateRange,
  fiscalQuarterFilterOptions,
  fiscalQuarterKeysTrailing,
  fiscalQuarterLabel,
  fiscalQuarterProspectiveOptions,
  fiscalQuarterRetrospectiveOptions,
  fiscalQuarterWindowEndKey,
  fiscalYearsInWindow,
  formatQuarterSelectionLabel,
  isProspectiveQuarterKey,
  isRetrospectiveQuarterKey,
  resolveQuarterBucket,
} from './fiscal';

const ANCHOR = new Date('2026-06-16T12:00:00Z');

describe('fiscal horizon', () => {
  it('defaults history start to FY26 Q1', () => {
    expect(effectiveFiscalHistoryStartKey()).toBe(FISCAL_HISTORY_START_KEY);
  });

  it('extends history start when older data quarters exist', () => {
    expect(effectiveFiscalHistoryStartKey(['2025-Q4', '2027-Q1'])).toBe('2025-Q4');
  });

  it('ends at current quarter + 8 forward from anchor', () => {
    expect(fiscalQuarterWindowEndKey(FISCAL_QUARTER_FORWARD_COUNT, ANCHOR)).toBe('2029-Q2');
  });

  it('prospective bucket is current + next 7 (8 quarters total)', () => {
    const opts = fiscalQuarterProspectiveOptions({ anchor: ANCHOR });
    expect(opts).toHaveLength(FISCAL_QUARTER_PROSPECTIVE_COUNT);
    expect(opts[0]!.key).toBe('2027-Q2');
    expect(opts[opts.length - 1]!.key).toBe('2029-Q1');
  });

  it('retrospective bucket is last 8 ended quarters (excludes current)', () => {
    const opts = fiscalQuarterRetrospectiveOptions({ anchor: ANCHOR });
    expect(opts).toHaveLength(FISCAL_QUARTER_RETROSPECTIVE_COUNT);
    expect(opts[0]!.key).toBe('2025-Q2');
    expect(opts[opts.length - 1]!.key).toBe('2027-Q1');
    expect(isRetrospectiveQuarterKey('2027-Q1', ANCHOR)).toBe(true);
    expect(isProspectiveQuarterKey('2027-Q1', ANCHOR)).toBe(false);
  });

  it('current quarter is prospective-only; last completed is retro-only', () => {
    // current = 2027-Q2, last completed = 2027-Q1
    expect(isProspectiveQuarterKey('2027-Q2', ANCHOR)).toBe(true);
    expect(isRetrospectiveQuarterKey('2027-Q2', ANCHOR)).toBe(false);
    expect(isRetrospectiveQuarterKey('2027-Q1', ANCHOR)).toBe(true);
    expect(isProspectiveQuarterKey('2027-Q1', ANCHOR)).toBe(false);
  });

  it('prospective upper bound excludes current+8', () => {
    expect(isProspectiveQuarterKey('2029-Q1', ANCHOR)).toBe(true);
    expect(isProspectiveQuarterKey('2029-Q2', ANCHOR)).toBe(false);
  });

  it('buckets are contiguous and non-overlapping (16 distinct quarters)', () => {
    const retro = bucketQuarterKeys('retrospective', ANCHOR);
    const pro = bucketQuarterKeys('prospective', ANCHOR);
    const overlap = retro.filter((k) => pro.includes(k));
    expect(overlap).toEqual([]);
    const union = new Set([...retro, ...pro]);
    expect(union.size).toBe(16);
    // retro ends immediately before prospective starts
    expect(retro[retro.length - 1]).toBe('2027-Q1');
    expect(pro[0]).toBe('2027-Q2');
  });

  it('resolveQuarterBucket parses the param with a per-page default', () => {
    expect(resolveQuarterBucket('retrospective')).toBe('retrospective');
    expect(resolveQuarterBucket('prospective')).toBe('prospective');
    expect(resolveQuarterBucket(null, 'retrospective')).toBe('retrospective');
    expect(resolveQuarterBucket('garbage', 'prospective')).toBe('prospective');
    expect(resolveQuarterBucket(undefined)).toBe('prospective');
  });

  it('filter options span history start through forward horizon', () => {
    const opts = fiscalQuarterFilterOptions({ anchor: ANCHOR });
    expect(opts[0]!.key).toBe(FISCAL_HISTORY_START_KEY);
    expect(opts[opts.length - 1]!.key).toBe('2029-Q2');
    expect(opts.length).toBeGreaterThanOrEqual(14);
  });

  it('opportunity close-date range covers the same window', () => {
    const { min, max } = fiscalOpportunityCloseDateRange({ anchor: ANCHOR });
    expect(min).toBe('2025-02-01');
    expect(max).toBe('2028-07-31');
  });

  it('fiscalQuarterLabel ignores sentinels and malformed keys', () => {
    expect(fiscalQuarterLabel('__none__')).toBe('');
    expect(fiscalQuarterLabel('2027-Q1')).toBe('FY27 Q1');
    expect(formatQuarterSelectionLabel(['2027-Q4', '__none__'])).toBe('FY27 Q4');
  });

  it('fiscalQuarterKeysTrailing returns count quarters ending at endKey', () => {
    const keys = fiscalQuarterKeysTrailing(8, '2027-Q1');
    expect(keys).toHaveLength(8);
    expect(keys[0]).toBe('2025-Q2');
    expect(keys[keys.length - 1]).toBe('2027-Q1');
  });

  it('fiscalYearsInWindow includes FY26 through forward years', () => {
    const years = fiscalYearsInWindow({ anchor: ANCHOR });
    expect(years).toContain(2026);
    expect(years).toContain(2029);
    expect(years[years.length - 1]).toBeGreaterThanOrEqual(2029);
  });
});

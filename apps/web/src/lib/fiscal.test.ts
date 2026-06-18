import { describe, expect, it } from 'vitest';
import {
  fiscalQuarterFromDate,
  fiscalQuartersForAccount,
  nextFiscalQuarterKey,
  parseQuartersParam,
  rollingFiscalQuarters,
} from './fiscal';

describe('nextFiscalQuarterKey', () => {
  it('advances within the same fiscal year', () => {
    expect(nextFiscalQuarterKey('2027-Q2')).toBe('2027-Q3');
  });

  it('rolls Q4 into Q1 of the next fiscal year', () => {
    expect(nextFiscalQuarterKey('2027-Q4')).toBe('2028-Q1');
  });

  it('returns null for malformed keys', () => {
    expect(nextFiscalQuarterKey('FY27-Q2')).toBeNull();
  });
});

describe('parseQuartersParam', () => {
  it('returns null for empty / missing params (all quarters)', () => {
    expect(parseQuartersParam(undefined)).toBeNull();
    expect(parseQuartersParam('')).toBeNull();
    expect(parseQuartersParam(',')).toBeNull();
  });

  it('parses comma-separated quarter keys', () => {
    expect(parseQuartersParam('2027-Q1,2027-Q2')).toEqual(
      new Set(['2027-Q1', '2027-Q2']),
    );
  });
});

describe('fiscalQuartersForAccount', () => {
  it('uses churnDate for Confirmed Churn accounts', () => {
    const keys = fiscalQuartersForAccount({
      bucket: 'Confirmed Churn',
      account: { churnDate: '2026-05-20' },
      opportunities: [{ closeDate: '2026-11-01' }],
    });
    expect(keys).toEqual(['2027-Q2']);
  });

  it('unions opportunity close dates for non-churn buckets', () => {
    const keys = fiscalQuartersForAccount({
      bucket: 'Saveable Risk',
      account: { churnDate: '2026-05-20' },
      opportunities: [
        { closeDate: '2026-05-20' },
        { closeDate: '2026-08-15' },
      ],
    });
    expect(keys.sort()).toEqual(['2027-Q2', '2027-Q3']);
  });
});

describe('rollingFiscalQuarters', () => {
  it('returns deduped quarters sorted ascending around an anchor date', () => {
    const anchor = new Date('2026-05-20T12:00:00.000Z');
    const quarters = rollingFiscalQuarters(2, 2, anchor);
    expect(quarters.length).toBeGreaterThan(0);
    expect(new Set(quarters.map((q) => q.key)).size).toBe(quarters.length);
    for (let i = 1; i < quarters.length; i += 1) {
      expect(quarters[i]!.key.localeCompare(quarters[i - 1]!.key)).toBeGreaterThan(
        0,
      );
    }
    expect(
      quarters.some((q) => q.key === fiscalQuarterFromDate('2026-05-20')!.key),
    ).toBe(true);
  });
});

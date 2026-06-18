import { describe, expect, it } from 'vitest';
import {
  asOfDateForQuarter,
  enumerateFiscalQuarterKeys,
  fiscalQuarterEnd,
  parseFiscalQuarterKey,
} from './fiscal.js';

describe('fiscalQuarterEnd', () => {
  it('returns last day of Zuora quarter', () => {
    expect(fiscalQuarterEnd(parseFiscalQuarterKey('2027-Q1')!)).toBe('2026-04-30');
    expect(fiscalQuarterEnd(parseFiscalQuarterKey('2027-Q2')!)).toBe('2026-07-31');
    expect(fiscalQuarterEnd(parseFiscalQuarterKey('2026-Q4')!)).toBe('2026-01-31');
  });
});

describe('enumerateFiscalQuarterKeys', () => {
  it('lists every quarter from FY26 Q1 through FY27 Q2', () => {
    const keys = enumerateFiscalQuarterKeys('2026-Q1', '2027-Q2');
    expect(keys).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
      '2027-Q1',
      '2027-Q2',
    ]);
  });
});

describe('asOfDateForQuarter', () => {
  it('uses quarter end for completed quarters', () => {
    expect(asOfDateForQuarter('2027-Q1', '2026-06-16T12:00:00.000Z')).toBe(
      '2026-04-30T23:59:59.000Z',
    );
  });

  it('uses today for the open quarter', () => {
    expect(asOfDateForQuarter('2027-Q2', '2026-06-16T12:00:00.000Z')).toBe(
      '2026-06-16T23:59:59.000Z',
    );
  });
});

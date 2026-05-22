import { describe, it, expect } from 'vitest';
import { slugifyAccountName } from './slug.js';

describe('slugifyAccountName', () => {
  it.each([
    ['Stenograph LLC', 'cust-stenograph'],
    ['Stenograph, LLC', 'cust-stenograph'],
    ['Acme Corp.', 'cust-acme'],
    ['Acme Corporation', 'cust-acme'],
    ['66degrees', 'cust-66degrees'],
    ['Zengine Ltd fka IntelliCentrics Inc.', 'cust-zengine'],
    ['IntelliCentrics, Inc.', 'cust-intellicentrics'],
    ['Some Co. (formerly Other Inc.)', 'cust-some'],
    ['New Relic, Inc.', 'cust-new-relic'],
    ['Kustomer, Inc', 'cust-kustomer'],
    ['  Spaced   Name  ', 'cust-spaced-name'],
    ['Multi---Hyphen', 'cust-multi-hyphen'],
    ['A.B.C. Holdings', 'cust-a.b.c'],
    ['Foo & Bar', 'cust-foo-bar'],
    ['100% Pure', 'cust-100-pure'],
    ['', null],
    [null, null],
    [undefined, null],
    ['   ', null],
    // Bare-suffix input — we only strip suffixes when preceded by other
    // words (so "Foo LLC" → "cust-foo" but "LLC" alone stays as-is and
    // becomes "cust-llc"). This is intentional; a real account whose
    // entire name is "LLC" is wildly unlikely.
    ['LLC', 'cust-llc'],
  ])('slugifyAccountName(%j) === %j', (input, expected) => {
    expect(slugifyAccountName(input as string | null | undefined)).toBe(expected);
  });

  it('caps at 80 chars total including cust- prefix', () => {
    const long = 'a'.repeat(200);
    const s = slugifyAccountName(long)!;
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.startsWith('cust-')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { safeHttpUrl, isLikelySfdcId } from './url-safety';

describe('safeHttpUrl', () => {
  it('accepts https URLs', () => {
    expect(safeHttpUrl('https://zuora.lightning.force.com/x')).toBe(
      'https://zuora.lightning.force.com/x',
    );
  });

  it('accepts http URLs', () => {
    expect(safeHttpUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('preserves query string and fragment', () => {
    expect(safeHttpUrl('https://example.com/a?b=1#c')).toBe(
      'https://example.com/a?b=1#c',
    );
  });

  it('rejects javascript: URLs (the main attack we care about)', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeHttpUrl('  javascript:void(0)  ')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects vbscript: URLs', () => {
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('rejects relative paths and bare strings', () => {
    expect(safeHttpUrl('/foo')).toBeNull();
    expect(safeHttpUrl('foo')).toBeNull();
  });

  it('rejects empty and null inputs', () => {
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
  });
});

describe('isLikelySfdcId', () => {
  it('accepts a 15-char SFDC id', () => {
    expect(isLikelySfdcId('001Po00001F2TRN')).toBe(true);
  });

  it('accepts an 18-char SFDC id', () => {
    expect(isLikelySfdcId('001Po00001F2TRNIA3')).toBe(true);
  });

  it('rejects path-injection attempts', () => {
    expect(isLikelySfdcId('001Po00001F2TRN/../logout')).toBe(false);
    expect(isLikelySfdcId('..%2Flogout')).toBe(false);
    expect(isLikelySfdcId('001 with space')).toBe(false);
  });

  it('rejects empty / null / non-string', () => {
    expect(isLikelySfdcId('')).toBe(false);
    expect(isLikelySfdcId(null)).toBe(false);
    expect(isLikelySfdcId(undefined)).toBe(false);
  });
});

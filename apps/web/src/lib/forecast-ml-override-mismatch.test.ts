import { describe, expect, it } from 'vitest';
import { sanitizeMlMismatchContext } from './sanitize-forecast-context';

describe('sanitizeMlMismatchContext', () => {
  it('collapses newlines so account names cannot orphan outside the section', () => {
    expect(
      sanitizeMlMismatchContext(
        'Gainsight records low engagement.\n\nPipedrive procurement pressure noted in notes.',
      ),
    ).toBe(
      'Gainsight records low engagement. Pipedrive procurement pressure noted in notes.',
    );
  });

  it('strips hedging and first-person discovery phrasing', () => {
    expect(
      sanitizeMlMismatchContext(
        'I found that Kustomer likely appears to be stalling on renewal scope.',
      ),
    ).toBe('Kustomer is stalling on renewal scope.');
  });

  it('preserves authoritative source-grounded phrasing', () => {
    const input =
      'CSE notes cite NetSuite pressure; Gainsight records non-response since April.';
    expect(sanitizeMlMismatchContext(input)).toBe(input);
  });
});

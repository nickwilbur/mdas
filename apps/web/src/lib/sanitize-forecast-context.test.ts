import { describe, expect, it } from 'vitest';
import {
  collapseContextWhitespace,
  sanitizeMlMismatchContext,
} from './sanitize-forecast-context';

describe('collapseContextWhitespace', () => {
  it('collapses newlines and repeated spaces', () => {
    expect(collapseContextWhitespace('line one\n\nline two   three')).toBe(
      'line one line two three',
    );
  });
});

describe('sanitizeMlMismatchContext', () => {
  it('strips leading discovery phrasing variants', () => {
    expect(sanitizeMlMismatchContext('We found that Acme is stalling.')).toBe(
      'Acme is stalling.',
    );
    expect(sanitizeMlMismatchContext('It appears that renewal scope narrowed.')).toBe(
      'renewal scope narrowed.',
    );
    expect(sanitizeMlMismatchContext('It looks like procurement is blocking.')).toBe(
      'procurement is blocking.',
    );
  });

  it('converts hedging phrases to declarative voice', () => {
    expect(sanitizeMlMismatchContext('Acme likely appears to be at risk.')).toBe(
      'Acme is at risk.',
    );
    expect(sanitizeMlMismatchContext('The customer might possibly churn.')).toBe(
      'The customer churn.',
    );
  });
});

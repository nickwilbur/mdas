import { describe, it, expect } from 'vitest';
import {
  classifyFreshness,
  confidenceFromFreshness,
  daysSince,
  signalId,
  stripHtml,
  truncate,
} from './utils.js';
import { SOURCE_FRESHNESS_HOURS } from './constants.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

describe('signalId', () => {
  it('joins prefix and key with a colon', () => {
    expect(signalId('sf', 'churn_risk')).toBe('sf:churn_risk');
  });
});

describe('classifyFreshness', () => {
  it('returns unknown for missing or invalid timestamps', () => {
    expect(classifyFreshness(null, NOW)).toBe('unknown');
    expect(classifyFreshness(undefined, NOW)).toBe('unknown');
    expect(classifyFreshness('not-a-date', NOW)).toBe('unknown');
  });

  it('returns fresh when within the default max age', () => {
    const observed = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    expect(classifyFreshness(observed, NOW)).toBe('fresh');
  });

  it('returns stale when older than max age hours', () => {
    const observed = new Date(
      NOW - (SOURCE_FRESHNESS_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    expect(classifyFreshness(observed, NOW)).toBe('stale');
  });

  it('respects a custom max age threshold', () => {
    const observed = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();
    expect(classifyFreshness(observed, NOW, 4)).toBe('stale');
  });
});

describe('daysSince', () => {
  it('returns null for missing or invalid dates', () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('garbage', NOW)).toBeNull();
  });

  it('floors whole days elapsed', () => {
    const iso = new Date(NOW - 3.9 * 86_400_000).toISOString();
    expect(daysSince(iso, NOW)).toBe(3);
  });
});

describe('stripHtml', () => {
  it('returns empty string for nullish input', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });

  it('strips tags and decodes common entities', () => {
    expect(stripHtml('<p>Hello&nbsp;&amp; <b>world</b></p>')).toBe('Hello & world');
    expect(stripHtml('A &lt; B &gt; C &#39;quote&#39;')).toBe("A < B > C 'quote'");
  });

  it('collapses whitespace', () => {
    expect(stripHtml('  line1\n\n  line2  ')).toBe('line1 line2');
  });
});

describe('truncate', () => {
  it('returns text unchanged when within limit', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('appends ellipsis when over limit', () => {
    expect(truncate('abcdefghij', 6)).toBe('abcde…');
  });
});

describe('confidenceFromFreshness', () => {
  it('preserves high confidence for fresh signals', () => {
    expect(confidenceFromFreshness('fresh', 'high')).toBe('high');
  });

  it('downgrades high to medium for stale or unknown freshness', () => {
    expect(confidenceFromFreshness('stale', 'high')).toBe('medium');
    expect(confidenceFromFreshness('unknown', 'high')).toBe('medium');
  });

  it('downgrades medium to low for stale or unknown freshness', () => {
    expect(confidenceFromFreshness('stale', 'medium')).toBe('low');
    expect(confidenceFromFreshness('unknown', 'medium')).toBe('low');
  });
});

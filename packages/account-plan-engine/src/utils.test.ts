import { describe, expect, it } from 'vitest';
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
    expect(signalId('sf', 'renewal_close_date')).toBe('sf:renewal_close_date');
  });
});

describe('classifyFreshness', () => {
  it('returns unknown for missing or invalid timestamps', () => {
    expect(classifyFreshness(null, NOW)).toBe('unknown');
    expect(classifyFreshness(undefined, NOW)).toBe('unknown');
    expect(classifyFreshness('not-a-date', NOW)).toBe('unknown');
  });

  it('marks observations within the freshness window as fresh', () => {
    const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(classifyFreshness(oneHourAgo, NOW)).toBe('fresh');
    expect(classifyFreshness(oneHourAgo, NOW, SOURCE_FRESHNESS_HOURS)).toBe('fresh');
  });

  it('marks observations beyond the freshness window as stale', () => {
    const fourDaysAgo = new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyFreshness(fourDaysAgo, NOW)).toBe('stale');
  });
});

describe('daysSince', () => {
  it('returns whole days between an ISO date and now', () => {
    expect(daysSince('2026-06-01T00:00:00Z', NOW)).toBe(15);
  });

  it('returns null for missing or invalid dates', () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('bad', NOW)).toBeNull();
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes common entities', () => {
    expect(stripHtml('<p>Stable&nbsp;<strong>renewal</strong>.</p>')).toBe('Stable renewal .');
    expect(stripHtml('A &amp; B &lt; C')).toBe('A & B < C');
  });

  it('returns empty string for nullish input', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('truncate', () => {
  it('appends ellipsis when text exceeds max length', () => {
    expect(truncate('abcdefghij', 6)).toBe('abcde…');
  });

  it('returns text unchanged when within limit', () => {
    expect(truncate('short', 10)).toBe('short');
  });
});

describe('confidenceFromFreshness', () => {
  it('downgrades high confidence when freshness is stale or unknown', () => {
    expect(confidenceFromFreshness('fresh', 'high')).toBe('high');
    expect(confidenceFromFreshness('stale', 'high')).toBe('medium');
    expect(confidenceFromFreshness('unknown', 'high')).toBe('medium');
    expect(confidenceFromFreshness('stale', 'medium')).toBe('low');
  });
});

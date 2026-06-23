import { describe, expect, it } from 'vitest';
import {
  classifyFreshness,
  confidenceFromFreshness,
  daysSince,
  signalId,
  stripHtml,
  truncate,
} from './utils.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

describe('account-plan utils', () => {
  describe('signalId', () => {
    it('joins prefix and key', () => {
      expect(signalId('sf', 'cse_sentiment')).toBe('sf:cse_sentiment');
    });
  });

  describe('classifyFreshness', () => {
    it('returns unknown for missing or invalid timestamps', () => {
      expect(classifyFreshness(null, NOW)).toBe('unknown');
      expect(classifyFreshness(undefined, NOW)).toBe('unknown');
      expect(classifyFreshness('not-a-date', NOW)).toBe('unknown');
    });

    it('classifies recent observations as fresh', () => {
      const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString();
      expect(classifyFreshness(oneHourAgo, NOW)).toBe('fresh');
    });

    it('classifies old observations as stale', () => {
      const threeDaysAgo = new Date(NOW - 72 * 60 * 60 * 1000).toISOString();
      expect(classifyFreshness(threeDaysAgo, NOW, 24)).toBe('stale');
    });
  });

  describe('daysSince', () => {
    it('returns null for missing or invalid dates', () => {
      expect(daysSince(null, NOW)).toBeNull();
      expect(daysSince('garbage', NOW)).toBeNull();
    });

    it('floors whole days elapsed', () => {
      const twoDaysAgo = new Date(NOW - 2.5 * 24 * 60 * 60 * 1000).toISOString();
      expect(daysSince(twoDaysAgo, NOW)).toBe(2);
    });
  });

  describe('stripHtml', () => {
    it('returns empty string for nullish input', () => {
      expect(stripHtml(null)).toBe('');
      expect(stripHtml(undefined)).toBe('');
    });

    it('strips tags and decodes common entities', () => {
      expect(stripHtml('<p>Hello&nbsp;<b>world</b> &amp; team</p>')).toBe(
        'Hello world & team',
      );
    });
  });

  describe('truncate', () => {
    it('leaves short text unchanged', () => {
      expect(truncate('abc', 10)).toBe('abc');
    });

    it('truncates with ellipsis', () => {
      expect(truncate('abcdefghij', 6)).toBe('abcde…');
    });
  });

  describe('confidenceFromFreshness', () => {
    it('downgrades high confidence when data is stale or unknown', () => {
      expect(confidenceFromFreshness('fresh', 'high')).toBe('high');
      expect(confidenceFromFreshness('stale', 'high')).toBe('medium');
      expect(confidenceFromFreshness('unknown', 'high')).toBe('medium');
      expect(confidenceFromFreshness('stale', 'medium')).toBe('low');
    });
  });
});

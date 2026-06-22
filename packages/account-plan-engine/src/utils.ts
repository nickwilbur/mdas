import type { SignalConfidence, SignalFreshness } from './types.js';
import { DAY_MS, SOURCE_FRESHNESS_HOURS } from './constants.js';

export function signalId(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}

export function classifyFreshness(
  observedAt: string | null | undefined,
  now: number,
  maxAgeHours = SOURCE_FRESHNESS_HOURS,
): SignalFreshness {
  if (!observedAt) return 'unknown';
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return 'unknown';
  const ageHours = (now - t) / (60 * 60 * 1000);
  return ageHours <= maxAgeHours ? 'fresh' : 'stale';
}

export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function confidenceFromFreshness(
  freshness: SignalFreshness,
  base: SignalConfidence = 'high',
): SignalConfidence {
  if (freshness === 'stale') return base === 'high' ? 'medium' : 'low';
  if (freshness === 'unknown') return base === 'high' ? 'medium' : 'low';
  return base;
}

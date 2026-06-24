import { describe, it, expect } from 'vitest';
import { DEFAULT_CTA_CONFIG, mergeConfig } from './config.js';

describe('mergeConfig', () => {
  it('returns defaults when no partial is provided', () => {
    expect(mergeConfig()).toEqual(DEFAULT_CTA_CONFIG);
  });

  it('overrides only the supplied fields', () => {
    const merged = mergeConfig({ dedupWindowDays: 7, maxCtasPerScan: 25 });
    expect(merged.dedupWindowDays).toBe(7);
    expect(merged.maxCtasPerScan).toBe(25);
    expect(merged.darkAccountLookbackDays).toBe(DEFAULT_CTA_CONFIG.darkAccountLookbackDays);
  });
});

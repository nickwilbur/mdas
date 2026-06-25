import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldRunCerebroGleanFallback } from './fallback.js';

describe('shouldRunCerebroGleanFallback', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['CEREBRO_GLEAN_FALLBACK', 'CEREBRO_API_TOKEN', 'CEREBRO_BASE_URL']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('defaults to fallback when REST token is absent', () => {
    expect(shouldRunCerebroGleanFallback()).toBe(true);
  });

  it('skips fallback when REST token is present', () => {
    process.env.CEREBRO_API_TOKEN = 'tok';
    expect(shouldRunCerebroGleanFallback()).toBe(false);
  });

  it('honors CEREBRO_GLEAN_FALLBACK=1 even with REST token', () => {
    process.env.CEREBRO_API_TOKEN = 'tok';
    process.env.CEREBRO_GLEAN_FALLBACK = '1';
    expect(shouldRunCerebroGleanFallback()).toBe(true);
  });

  it('honors CEREBRO_GLEAN_FALLBACK=0 without REST token', () => {
    process.env.CEREBRO_GLEAN_FALLBACK = '0';
    expect(shouldRunCerebroGleanFallback()).toBe(false);
  });
});

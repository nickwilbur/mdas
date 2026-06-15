import { describe, expect, it } from 'vitest';
import { mapCerebroCapabilities, BASE_REST_CAPABILITIES } from './capabilities.js';

describe('mapCerebroCapabilities', () => {
  it('includes baseline REST capabilities', () => {
    const caps = mapCerebroCapabilities();
    expect(caps.length).toBeGreaterThanOrEqual(BASE_REST_CAPABILITIES.length);
    expect(caps.some((c) => c.id === 'rest:account-details')).toBe(true);
  });

  it('adds dynamic guide capability when guide object present', () => {
    const caps = mapCerebroCapabilities({ guide: { endpoints: [] } });
    expect(caps.some((c) => c.id === 'rest:guide-dynamic')).toBe(true);
  });
});

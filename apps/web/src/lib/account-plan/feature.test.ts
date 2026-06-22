import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { isExpand3AccountPlanEnabled, isExpand3AccountPlanBulkEnabled } from './feature.js';

describe('account plan feature flags', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to disabled', () => {
    expect(isExpand3AccountPlanEnabled()).toBe(false);
    expect(isExpand3AccountPlanBulkEnabled()).toBe(false);
  });

  it('enables when env is true', () => {
    vi.stubEnv('ENABLE_EXPAND3_ACCOUNT_PLAN', 'true');
    expect(isExpand3AccountPlanEnabled()).toBe(true);
  });
});

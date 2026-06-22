import { describe, it, expect } from 'vitest';
import { checkExpand3Eligibility } from '@mdas/account-plan-engine';
import { EXPAND3_FRANCHISE } from '@mdas/canonical';
import { isExpand3AccountPlanEnabled } from '@/lib/account-plan/feature';

describe('Account plan UI guards', () => {
  it('feature flag defaults off', () => {
    expect(isExpand3AccountPlanEnabled()).toBe(false);
  });

  it('non-Expand 3 franchise is not eligible', () => {
    const result = checkExpand3Eligibility({
      account: { franchise: 'Enterprise' },
      opportunities: [],
    } as never);
    expect(result.eligible).toBe(false);
    expect(result.code).toBe('not_expand3');
  });

  it('Expand 3 franchise constant matches product scope', () => {
    expect(EXPAND3_FRANCHISE).toBe('Expand 3');
  });
});

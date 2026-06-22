import { describe, it, expect } from 'vitest';
import { checkExpand3Eligibility } from './eligibility.js';
import { renewalOpp, testView } from './fixtures.js';

describe('checkExpand3Eligibility', () => {
  it('allows active Expand 3 accounts', () => {
    const v = testView({}, [renewalOpp('2027-03-01')]);
    expect(checkExpand3Eligibility(v)).toEqual({ eligible: true });
  });

  it('rejects non-Expand 3 franchise', () => {
    const v = testView({ franchise: 'Enterprise' });
    expect(checkExpand3Eligibility(v).code).toBe('not_expand3');
  });

  it('rejects null view', () => {
    expect(checkExpand3Eligibility(null).code).toBe('not_found');
  });

  it('rejects inactive Expand 3 churned accounts', () => {
    const v = testView({ cseSentiment: 'Confirmed Churn' });
    expect(checkExpand3Eligibility(v).code).toBe('inactive_expand3');
  });
});

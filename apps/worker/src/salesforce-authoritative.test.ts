import { describe, expect, it } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import { applySalesforceAuthoritativeSnapshot } from './salesforce-authoritative.js';

function accountFixture(id: string): CanonicalAccount {
  return {
    accountId: id,
    accountName: id,
    lastUpdated: new Date().toISOString(),
  } as CanonicalAccount;
}

describe('applySalesforceAuthoritativeSnapshot', () => {
  it('drops prior-only accounts and opportunities when SF returns a fresh set', () => {
    const merged = {
      accounts: [accountFixture('A1'), accountFixture('STALE')],
      opportunities: [
        { opportunityId: 'O-stale', accountId: 'STALE' } as never,
        { opportunityId: 'O-live', accountId: 'A1' } as never,
      ],
    };
    const sf = {
      accounts: [accountFixture('A1')],
      opportunities: [{ opportunityId: 'O-live', accountId: 'A1' } as never],
    };
    const out = applySalesforceAuthoritativeSnapshot(merged, sf);
    expect(out.accounts.map((a) => a.accountId)).toEqual(['A1']);
    expect(out.opportunities.map((o) => o.opportunityId)).toEqual(['O-live']);
  });

  it('leaves merged data unchanged when SF returned nothing', () => {
    const merged = {
      accounts: [accountFixture('A1')],
      opportunities: [],
    };
    expect(applySalesforceAuthoritativeSnapshot(merged, {})).toBe(merged);
  });

  it('drops stale opportunities when SF returns accounts but zero opps', () => {
    const merged = {
      accounts: [accountFixture('A1')],
      opportunities: [
        { opportunityId: 'O-stale', accountId: 'A1' } as never,
        { opportunityId: 'O-other', accountId: 'STALE' } as never,
      ],
    };
    const sf = {
      accounts: [accountFixture('A1')],
      opportunities: [],
    };
    const out = applySalesforceAuthoritativeSnapshot(merged, sf);
    expect(out.accounts.map((a) => a.accountId)).toEqual(['A1']);
    expect(out.opportunities).toEqual([]);
  });
});

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

  it('keeps prior-snapshot accounts referenced by SF opportunities even when missing from the SF account query', () => {
    const merged = {
      accounts: [accountFixture('A1'), accountFixture('OPP_ONLY')],
      opportunities: [
        { opportunityId: 'O-live', accountId: 'A1' } as never,
        { opportunityId: 'O-orphan', accountId: 'OPP_ONLY' } as never,
      ],
    };
    const sf = {
      accounts: [accountFixture('A1')],
      opportunities: [
        { opportunityId: 'O-live', accountId: 'A1' } as never,
        { opportunityId: 'O-orphan', accountId: 'OPP_ONLY' } as never,
      ],
    };
    const out = applySalesforceAuthoritativeSnapshot(merged, sf);
    expect(out.accounts.map((a) => a.accountId).sort()).toEqual([
      'A1',
      'OPP_ONLY',
    ]);
    expect(out.opportunities.map((o) => o.opportunityId).sort()).toEqual([
      'O-live',
      'O-orphan',
    ]);
  });

  it('retains in-quarter renewal downsell opps dropped from the SF opp payload', () => {
    const merged = {
      accounts: [accountFixture('A1'), accountFixture('BIRD')],
      opportunities: [
        {
          opportunityId: 'O-live',
          accountId: 'A1',
          type: 'Renewal',
          closeDate: '2026-06-15',
          forecastMostLikely: -50_000,
        } as never,
        {
          opportunityId: 'O-dropped',
          accountId: 'BIRD',
          type: 'Renewal',
          closeDate: '2026-05-08',
          forecastMostLikely: -199_904,
        } as never,
      ],
    };
    const sf = {
      accounts: [accountFixture('A1')],
      opportunities: [
        {
          opportunityId: 'O-live',
          accountId: 'A1',
          type: 'Renewal',
          closeDate: '2026-06-15',
          forecastMostLikely: -50_000,
        } as never,
      ],
    };
    const out = applySalesforceAuthoritativeSnapshot(merged, sf, {
      asOfDate: '2026-05-13',
    });
    expect(out.opportunities.map((o) => o.opportunityId).sort()).toEqual([
      'O-dropped',
      'O-live',
    ]);
    expect(out.accounts.map((a) => a.accountId).sort()).toEqual(['A1', 'BIRD']);
  });

  it('leaves merged data unchanged when SF returned nothing', () => {
    const merged = {
      accounts: [accountFixture('A1')],
      opportunities: [],
    };
    expect(applySalesforceAuthoritativeSnapshot(merged, {})).toBe(merged);
  });
});

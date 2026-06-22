import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import { shouldSkipCerebroRestFetch } from './freshness.js';

function account(
  partial: Partial<CanonicalAccount> = {},
): CanonicalAccount {
  return {
    accountId: '001TEST',
    accountName: 'Test',
    salesforceAccountId: '001TEST',
    ...partial,
  } as CanonicalAccount;
}

describe('shouldSkipCerebroRestFetch', () => {
  let savedForce: string | undefined;

  beforeEach(() => {
    savedForce = process.env.FORCE_REFRESH;
    delete process.env.FORCE_REFRESH;
  });

  afterEach(() => {
    if (savedForce === undefined) delete process.env.FORCE_REFRESH;
    else process.env.FORCE_REFRESH = savedForce;
  });

  it('never skips when Risk Category and narrative are both missing', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(
      shouldSkipCerebroRestFetch(
        account({
          lastFetchedFromSource: { cerebro: oneHourAgo },
          cerebroRisks: { engagementRisk: true } as CanonicalAccount['cerebroRisks'],
        }),
      ),
    ).toBe(false);
  });

  it('skips when narrative exists and cerebro stamp is fresh', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(
      shouldSkipCerebroRestFetch(
        account({
          cerebroRiskCategory: 'High',
          cerebroRiskAnalysis: 'Executive engagement is low.',
          lastFetchedFromSource: { cerebro: oneHourAgo },
        }),
      ),
    ).toBe(true);
  });

  it('refreshes stale narrative even when category is present', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(
      shouldSkipCerebroRestFetch(
        account({
          cerebroRiskCategory: 'Medium',
          lastFetchedFromSource: { cerebro: twoDaysAgo },
        }),
      ),
    ).toBe(false);
  });

  it('honors FORCE_REFRESH=1', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    process.env.FORCE_REFRESH = '1';
    expect(
      shouldSkipCerebroRestFetch(
        account({
          cerebroRiskCategory: 'Low',
          cerebroRiskAnalysis: 'Stable account.',
          lastFetchedFromSource: { cerebro: oneHourAgo },
        }),
      ),
    ).toBe(false);
  });
});

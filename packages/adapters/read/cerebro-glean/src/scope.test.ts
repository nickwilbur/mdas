import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';

vi.mock('@mdas/db', () => ({
  latestSuccessfulRun: vi.fn(),
  readSnapshotAccounts: vi.fn(),
}));

import { resolveCerebroGleanScope } from './scope.js';

function account(
  id: string,
  opts: {
    cerebroFetchedAt?: string;
    cerebroRiskCategory?: string;
    allTimeARR?: number;
  } = {},
): CanonicalAccount {
  return {
    accountId: id,
    accountName: `Account ${id}`,
    salesforceAccountId: id,
    allTimeARR: opts.allTimeARR ?? 0,
    cerebroRiskCategory: opts.cerebroRiskCategory,
    lastFetchedFromSource: opts.cerebroFetchedAt
      ? { cerebro: opts.cerebroFetchedAt }
      : {},
  } as CanonicalAccount;
}

function ctx(
  accounts: CanonicalAccount[],
  cerebroRestCoverage?: RefreshContext['cerebroRestCoverage'],
): RefreshContext {
  return {
    refreshId: 'r1',
    asOf: new Date('2026-06-01'),
    franchise: 'Expand 3',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    audit: { record: vi.fn() },
    priorRun: { id: 'prior', accounts, opportunities: [] },
    cerebroRestCoverage,
  };
}

describe('resolveCerebroGleanScope', () => {
  beforeEach(() => {
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
  });

  it('returns null when priorRun has no accounts', async () => {
    const out = await resolveCerebroGleanScope(
      ctx([]),
    );
    expect(out).toBeNull();
  });

  it('prioritizes accounts without cerebro signals when limit is set', async () => {
    process.env.GLEAN_ENRICH_LIMIT = '2';
    const accounts = [
      account('signal', { cerebroRiskCategory: 'Red', allTimeARR: 1_000_000 }),
      account('no-signal-high-arr', { allTimeARR: 500_000 }),
      account('no-signal-low-arr', { allTimeARR: 100_000 }),
    ];
    const out = await resolveCerebroGleanScope(ctx(accounts));
    expect(out?.scopedAccounts).toBe(2);
    expect(out?.toSearch.map((a) => a.accountId)).toEqual([
      'no-signal-high-arr',
      'no-signal-low-arr',
    ]);
  });

  it('skips accounts already covered by cerebro-rest', async () => {
    const accounts = [account('A1'), account('A2'), account('A3')];
    const out = await resolveCerebroGleanScope(
      ctx(accounts, {
        restAttempted: true,
        enrichedAccountIds: ['A1', 'A2'],
      }),
    );
    expect(out?.toSearch.map((a) => a.accountId)).toEqual(['A3']);
    expect(out?.skippedRestCovered).toBe(2);
    expect(out?.restAttempted).toBe(true);
  });

  it('skips accounts with fresh cerebro timestamps', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const accounts = [
      account('fresh', { cerebroFetchedAt: oneHourAgo }),
      account('stale'),
    ];
    const out = await resolveCerebroGleanScope(ctx(accounts));
    expect(out?.toSearch.map((a) => a.accountId)).toEqual(['stale']);
    expect(out?.skippedFresh).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';

vi.mock('@mdas/db', () => ({
  latestSuccessfulRun: vi.fn(),
  readSnapshotAccounts: vi.fn(),
}));

import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { resolveGleanMcpScope } from './scope.js';

function account(
  id: string,
  opts: { gleanFetchedAt?: string } = {},
): CanonicalAccount {
  return {
    accountId: id,
    accountName: `Account ${id}`,
    salesforceAccountId: id,
    lastFetchedFromSource: opts.gleanFetchedAt
      ? { 'glean-mcp': opts.gleanFetchedAt }
      : {},
  } as CanonicalAccount;
}

function ctx(accounts: CanonicalAccount[]): RefreshContext {
  return {
    refreshId: 'r1',
    asOf: new Date('2026-06-01'),
    franchise: 'Expand 3',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    audit: { record: vi.fn() },
    priorRun: { id: 'prior', accounts, opportunities: [] },
  };
}

describe('resolveGleanMcpScope', () => {
  beforeEach(() => {
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
  });

  it('returns null when no prior run exists', async () => {
    const out = await resolveGleanMcpScope();
    expect(out).toBeNull();
    expect(latestSuccessfulRun).toHaveBeenCalled();
  });

  it('uses priorRun from context without hitting the database', async () => {
    const accounts = [account('A1'), account('A2')];
    const out = await resolveGleanMcpScope(ctx(accounts));
    expect(out?.accounts).toHaveLength(2);
    expect(latestSuccessfulRun).not.toHaveBeenCalled();
    expect(readSnapshotAccounts).not.toHaveBeenCalled();
  });

  it('skips accounts with fresh glean-mcp timestamps', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const accounts = [
      account('fresh', { gleanFetchedAt: oneHourAgo }),
      account('stale'),
    ];
    const out = await resolveGleanMcpScope(ctx(accounts));
    expect(out?.accounts.map((a) => a.accountId)).toEqual(['stale']);
    expect(out?.skippedFresh).toBe(1);
    expect(out?.scopedAccounts).toBe(2);
  });

  it('honors GLEAN_ENRICH_LIMIT when set', async () => {
    process.env.GLEAN_ENRICH_LIMIT = '2';
    const accounts = [account('A1'), account('A2'), account('A3')];
    const out = await resolveGleanMcpScope(ctx(accounts));
    expect(out?.scopedAccounts).toBe(2);
    expect(out?.accounts).toHaveLength(2);
  });
});

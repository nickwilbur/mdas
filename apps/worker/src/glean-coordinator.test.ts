import { describe, expect, it, vi } from 'vitest';
import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';

vi.mock('@mdas/adapter-cerebro-glean', () => ({
  resolveCerebroGleanScope: vi.fn(),
  searchCerebroDocsForAccount: vi.fn(),
  mapCerebroDocsToAccountPartials: vi.fn(),
}));

vi.mock('@mdas/adapter-glean-mcp', () => ({
  enrichGleanMcpAccount: vi.fn(),
  resolveGleanMcpScope: vi.fn(),
}));

import {
  mapCerebroDocsToAccountPartials,
  resolveCerebroGleanScope,
  searchCerebroDocsForAccount,
} from '@mdas/adapter-cerebro-glean';
import { enrichGleanMcpAccount, resolveGleanMcpScope } from '@mdas/adapter-glean-mcp';
import { runCoordinatedGleanEnrichment, shouldUseCoordinatedGleanLoop } from './glean-coordinator.js';

const account = (id: string): CanonicalAccount =>
  ({
    accountId: id,
    accountName: `Account ${id}`,
    salesforceAccountId: id,
  }) as CanonicalAccount;

const client = { search: vi.fn() } as never;

function ctx(): RefreshContext {
  return {
    refreshId: 'r1',
    asOf: new Date('2026-06-01'),
    franchise: 'Expand 3',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    audit: { record: vi.fn() },
    priorRun: {
      id: 'prior',
      accounts: [account('A1'), account('A2')],
      opportunities: [],
    },
  };
}

describe('shouldUseCoordinatedGleanLoop', () => {
  it('is enabled by default', () => {
    delete process.env.GLEAN_COORDINATED_LOOP;
    expect(shouldUseCoordinatedGleanLoop()).toBe(true);
  });

  it('can be disabled via GLEAN_COORDINATED_LOOP=0', () => {
    process.env.GLEAN_COORDINATED_LOOP = '0';
    expect(shouldUseCoordinatedGleanLoop()).toBe(false);
    delete process.env.GLEAN_COORDINATED_LOOP;
  });
});

describe('runCoordinatedGleanEnrichment', () => {
  it('enriches the union of cerebro and glean-mcp account sets in one pass', async () => {
    vi.mocked(resolveCerebroGleanScope).mockResolvedValue({
      toSearch: [account('A1')],
      scopedAccounts: 2,
      skippedFresh: 0,
      skippedRestCovered: 0,
      restAttempted: true,
    });
    vi.mocked(resolveGleanMcpScope).mockResolvedValue({
      accounts: [account('A2')],
      scopedAccounts: 2,
      skippedFresh: 0,
    });
    vi.mocked(searchCerebroDocsForAccount).mockResolvedValue([
      { title: 'Cerebro', url: 'https://cerebro/a1', datasource: 'cerebro' },
    ]);
    vi.mocked(mapCerebroDocsToAccountPartials).mockReturnValue([
      { accountId: 'A1', cerebroRisks: {} } as CanonicalAccount,
    ]);
    vi.mocked(enrichGleanMcpAccount).mockResolvedValue({
      accountId: 'A2',
      recentMeetings: [],
    });

    const out = await runCoordinatedGleanEnrichment(client, ctx());
    expect(searchCerebroDocsForAccount).toHaveBeenCalledTimes(1);
    expect(enrichGleanMcpAccount).toHaveBeenCalledTimes(1);
    expect(out.cerebroGlean.accounts).toHaveLength(1);
    expect(out.gleanMcp.accounts).toHaveLength(1);
  });
});

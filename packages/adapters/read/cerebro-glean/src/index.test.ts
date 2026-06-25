import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';
import { GleanClient } from '../../_shared/src/glean.js';

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
}));

vi.mock('@mdas/db', () => ({
  latestSuccessfulRun: vi.fn(),
  readSnapshotAccounts: vi.fn(),
}));

import { cerebroGleanAdapter } from './index.js';

function account(id: string): CanonicalAccount {
  return {
    accountId: id,
    accountName: `Account ${id}`,
    salesforceAccountId: id,
  } as CanonicalAccount;
}

function ctx(partial: Partial<RefreshContext> = {}): RefreshContext {
  return {
    refreshId: 'r1',
    asOf: new Date(),
    franchise: 'Expand 3',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    audit: { record: vi.fn() },
    priorRun: {
      id: 'prior',
      accounts: [account('A1'), account('A2')],
      opportunities: [],
    },
    ...partial,
  };
}

describe('cerebroGleanAdapter — REST coverage skip', () => {
  beforeEach(() => {
    process.env.GLEAN_MCP_TOKEN = 't';
    process.env.GLEAN_MCP_BASE_URL = 'https://glean.example/mcp/default';
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
    searchMock.mockReset();
    searchMock.mockResolvedValue({ documents: [] });
    vi.spyOn(GleanClient.prototype, 'search').mockImplementation(searchMock);
  });

  afterEach(() => {
    delete process.env.GLEAN_MCP_TOKEN;
    delete process.env.GLEAN_MCP_BASE_URL;
    delete process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.FORCE_REFRESH;
    vi.restoreAllMocks();
  });

  it('skips Glean search when cerebro-rest already enriched all accounts', async () => {
    const result = await cerebroGleanAdapter.fetch(
      { franchise: 'Expand 3' },
      ctx({
        cerebroRestCoverage: {
          restAttempted: true,
          enrichedAccountIds: ['A1', 'A2'],
        },
      }),
    );
    expect(result.accounts).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('searches only accounts REST did not cover', async () => {
    await cerebroGleanAdapter.fetch(
      { franchise: 'Expand 3' },
      ctx({
        cerebroRestCoverage: {
          restAttempted: true,
          enrichedAccountIds: ['A1'],
        },
      }),
    );
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]?.[0]?.query).toContain('Account A2');
  });
});

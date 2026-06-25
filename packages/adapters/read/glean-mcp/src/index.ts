// Glean MCP read-only adapter — account context + cross-source evidence.
import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
} from '@mdas/canonical';
import { mapWithConcurrency } from '../../_shared/src/concurrency.js';
import {
  GleanClient,
  readGleanCredsFromEnv,
  resolveGleanClient,
} from '../../_shared/src/glean.js';
import { enrichGleanMcpAccount } from './enrich-account.js';
import { resolveGleanMcpScope } from './scope.js';

export const isReadOnly: true = true;

const DEFAULT_CONCURRENCY = 5;

export const gleanMcpAdapter: ReadAdapter = {
  name: 'glean-mcp',
  source: 'glean-mcp',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readGleanCredsFromEnv();
    const client = resolveGleanClient(ctx, creds);
    if (!client) return { accounts: [], opportunities: [] };

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;
    const concurrency =
      Number(process.env.GLEAN_CONCURRENCY) || DEFAULT_CONCURRENCY;

    const scope = await resolveGleanMcpScope(ctx);
    if (!scope) {
      log?.info('glean-mcp.skip', { reason: 'no prior snapshot' });
      return { accounts: [], opportunities: [] };
    }

    const { accounts: priorAccounts, scopedAccounts, skippedFresh } = scope;
    if (priorAccounts.length === 0) {
      log?.info('glean-mcp.skip', {
        reason: 'all accounts within freshness window',
        scopedAccounts,
        skippedFresh,
      });
      return { accounts: [], opportunities: [] };
    }

    log?.info('glean-mcp.start', {
      accountCount: priorAccounts.length,
      scopedAccounts,
      skippedFresh,
      concurrency,
    });

    const startedAt = Date.now();
    let gleanProcessed = 0;
    const partials = await mapWithConcurrency(
      priorAccounts,
      concurrency,
      async (account: CanonicalAccount): Promise<Partial<CanonicalAccount> | null> => {
        ctx?.reportProgress?.(++gleanProcessed, priorAccounts.length, account.accountName);
        try {
          return await enrichGleanMcpAccount(client, account, refreshAt);
        } catch (err) {
          log?.warn('glean-mcp.account.failed', {
            accountId: account.accountId,
            error: (err as Error).message,
          });
          return null;
        }
      },
    );

    const accounts = partials.filter(
      (p): p is Partial<CanonicalAccount> & { accountId: string } => p !== null,
    );
    log?.info('glean-mcp.complete', {
      accountsEnriched: accounts.length,
      totalAccounts: priorAccounts.length,
      durationMs: Date.now() - startedAt,
    });

    return { accounts: accounts as CanonicalAccount[], opportunities: [] };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    const client = resolveGleanClient(undefined, creds);
    return client!.healthCheck();
  },
};

export { fetchAccountContext } from './account-context.js';
export { enrichGleanMcpAccount } from './enrich-account.js';
export { resolveGleanMcpScope } from './scope.js';
export {
  fetchAccountEvidence,
  applyContextAndEvidenceToAccount,
  buildSlackSearchQueries,
  buildCombinedNonSlackQuery,
  fetchSlackChannelDocs,
} from './evidence.js';
export { mergeRecentMeetings } from '@mdas/canonical';
export {
  GleanClient,
  readGleanCredsFromEnv,
  resolveGleanClient,
} from '../../_shared/src/glean.js';
export default gleanMcpAdapter;

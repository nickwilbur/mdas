// Cerebro adapter via Glean federated search (datasource: `cerebro`).
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
  type GleanDocument,
} from '../../_shared/src/glean.js';
import {
  mapCerebroDocsToAccountPartials,
  searchCerebroDocsForAccount,
} from './enrich-account.js';
import { resolveCerebroGleanScope } from './scope.js';

export const isReadOnly: true = true;

const DEFAULT_CONCURRENCY = 2;

export const cerebroGleanAdapter: ReadAdapter = {
  name: 'cerebro-glean',
  source: 'cerebro',
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
      Number(process.env.CEREBRO_CONCURRENCY) || DEFAULT_CONCURRENCY;

    const scope = await resolveCerebroGleanScope(ctx);
    if (!scope) {
      log?.info('cerebro.skip', { reason: 'no prior snapshot' });
      return { accounts: [], opportunities: [] };
    }

    const { toSearch, scopedAccounts, skippedFresh, skippedRestCovered, restAttempted } =
      scope;
    if (toSearch.length === 0) {
      log?.info('cerebro.skip', {
        reason: restAttempted
          ? 'cerebro-rest covered all accounts needing enrichment'
          : 'all accounts within freshness window',
        scopedAccounts,
        skippedFresh,
        skippedRestCovered,
        restAttempted,
      });
      return { accounts: [], opportunities: [] };
    }

    log?.info('cerebro.start', {
      accountCount: toSearch.length,
      scopedAccounts,
      skippedFresh,
      skippedRestCovered,
      restAttempted,
      concurrency,
    });
    const startedAt = Date.now();

    const startedSearches = Date.now();
    let searchFailures = 0;
    let cerebroProcessed = 0;
    const perAccount = await mapWithConcurrency(
      toSearch,
      concurrency,
      async (account: CanonicalAccount): Promise<GleanDocument[]> => {
        ctx?.reportProgress?.(++cerebroProcessed, toSearch.length, account.accountName);
        try {
          return await searchCerebroDocsForAccount(client, account);
        } catch (err) {
          searchFailures += 1;
          log?.warn('cerebro.search.account.failed', {
            accountId: account.accountId,
            error: (err as Error).message,
          });
          return [];
        }
      },
    );
    const allDocs = perAccount.flat();

    log?.info('cerebro.search.complete', {
      searchedAccounts: toSearch.length,
      searchFailures,
      docCount: allDocs.length,
      durationMs: Date.now() - startedSearches,
    });

    if (allDocs.length === 0) {
      return { accounts: [], opportunities: [] };
    }

    const accounts = mapCerebroDocsToAccountPartials(allDocs, refreshAt);
    log?.info('cerebro.complete', {
      mapped: accounts.length,
      uniqueAccounts: accounts.length,
      durationMs: Date.now() - startedAt,
    });

    return { accounts, opportunities: [] };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    const client = resolveGleanClient(undefined, creds);
    return client!.healthCheck();
  },
};

export {
  mapCerebroDocsToAccountPartials,
  searchCerebroDocsForAccount,
} from './enrich-account.js';
export { resolveCerebroGleanScope } from './scope.js';
export default cerebroGleanAdapter;

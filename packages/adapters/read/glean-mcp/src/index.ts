// Glean MCP read-only adapter — account context + cross-source evidence.
//
// Per-account enrichment populated:
//   - accountPlanLinks: top plan / QBR / business-review docs from gdrive
//     (see ./account-context.ts)
//   - recentMeetings: calendar + slack + staircase signals
//     (see ./evidence.ts)
//   - sourceLinks: append per-source citations for the Account Drill-In
//   - lastFetchedFromSource['glean-mcp']: refresh timestamp
//
// Discovery: this adapter reads the prior-snapshot Account list from
// @mdas/db (same pattern as localSnapshotsAdapter). It does NOT discover
// new accounts — that responsibility belongs to the Salesforce adapter.
// In dev environments where SF is mocked, the prior snapshot from the
// Python importer (or seed-real-data.sql) provides the account set.
//
// Concurrency: bounded to GLEAN_CONCURRENCY (default 5) so we don't
// hammer Glean with 236 simultaneous searches. Per-refresh document
// cache in GleanClient further deduplicates repeat queries.
import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
} from '@mdas/canonical';
import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { GleanClient, readGleanCredsFromEnv } from '../../_shared/src/glean.js';
import { fetchAccountContext } from './account-context.js';
import { fetchAccountEvidence, applyContextAndEvidenceToAccount } from './evidence.js';

export const isReadOnly: true = true;

const DEFAULT_CONCURRENCY = 5;

/**
 * Run async fn over each item with bounded parallelism.
 * Order of results matches order of input.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export const gleanMcpAdapter: ReadAdapter = {
  name: 'glean-mcp',
  source: 'glean-mcp',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { accounts: [], opportunities: [] };

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;
    const concurrency = Number(process.env.GLEAN_CONCURRENCY ?? DEFAULT_CONCURRENCY);

    // Discover the account set from the prior successful snapshot. If
    // there is no prior snapshot (cold start), there's nothing to enrich
    // yet — return empty and let SF run first.
    const prior = await latestSuccessfulRun();
    if (!prior) {
      log?.info('glean-mcp.skip', { reason: 'no prior snapshot' });
      return { accounts: [], opportunities: [] };
    }
    const priorAccounts = await readSnapshotAccounts(prior.id);
    if (priorAccounts.length === 0) {
      log?.info('glean-mcp.skip', { reason: 'prior snapshot has no accounts' });
      return { accounts: [], opportunities: [] };
    }

    const client = new GleanClient(creds);
    log?.info('glean-mcp.start', {
      accountCount: priorAccounts.length,
      concurrency,
    });

    const startedAt = Date.now();
    const partials = await mapWithConcurrency(
      priorAccounts,
      concurrency,
      async (account: CanonicalAccount): Promise<Partial<CanonicalAccount> | null> => {
        const input = { accountId: account.accountId, accountName: account.accountName };
        const [context, evidence] = await Promise.all([
          fetchAccountContext(client, input),
          fetchAccountEvidence(client, input),
        ]);
        // Skip emitting a partial if Glean returned nothing — saves
        // mergeAdapterResults work.
        if (
          context.accountPlanLinks.length === 0 &&
          evidence.recentMeetings.length === 0
        ) {
          return null;
        }
        const patch: Partial<CanonicalAccount> = {
          accountId: account.accountId,
        };
        applyContextAndEvidenceToAccount(patch, context, evidence, refreshAt);
        return patch;
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

    // Cast acknowledges that we're returning Partial records the worker's
    // mergeAdapterResults will spread onto the full prior-snapshot record.
    return { accounts: accounts as CanonicalAccount[], opportunities: [] };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    return new GleanClient(creds).healthCheck();
  },
};

export default gleanMcpAdapter;

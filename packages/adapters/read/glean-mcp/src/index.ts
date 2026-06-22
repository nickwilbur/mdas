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
import {
  GleanClient,
  isFreshEnoughToSkip,
  readGleanCredsFromEnv,
  resolveGleanEnrichLimit,
} from '../../_shared/src/glean.js';
import { fetchAccountContext } from './account-context.js';
import { fetchAccountEvidence, applyContextAndEvidenceToAccount } from './evidence.js';

export const isReadOnly: true = true;

// Default 5 parallel account workers. The orchestrator defers glean-mcp
// until cerebro + gainsight finish so it usually runs with exclusive
// access to Glean's rate limiter; tune down via GLEAN_CONCURRENCY if
// 429s appear.
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
    // Use `||` not `??` because docker-compose forwards unset host env
    // vars as empty strings; Number("") is 0 → zero workers → no-op.
    const concurrency =
      Number(process.env.GLEAN_CONCURRENCY) || DEFAULT_CONCURRENCY;

    // Discover the account set from the prior successful snapshot. If
    // there is no prior snapshot (cold start), there's nothing to enrich
    // yet — return empty and let SF run first.
    //
    // Fast path: use the orchestrator's shared prefetch (ctx.priorRun)
    // when available. Otherwise fall back to an independent lookup so
    // this adapter still works when invoked outside the orchestrator
    // (e.g. one-off scripts).
    let allAccounts: CanonicalAccount[];
    if (ctx?.priorRun) {
      allAccounts = ctx.priorRun.accounts;
    } else {
      const prior = await latestSuccessfulRun();
      if (!prior) {
        log?.info('glean-mcp.skip', { reason: 'no prior snapshot' });
        return { accounts: [], opportunities: [] };
      }
      allAccounts = await readSnapshotAccounts(prior.id);
    }
    if (allAccounts.length === 0) {
      log?.info('glean-mcp.skip', { reason: 'prior snapshot has no accounts' });
      return { accounts: [], opportunities: [] };
    }
    // Enrichment scope: by default cover **every** account so downstream
    // never sees "no Glean meetings / account plans" rationales just
    // because an account fell past an arbitrary cap. Cerebro adopted
    // this policy in May 2026; we now match it here. resolveGleanEnrichLimit()
    // also fixes the `Number("0") || 50 === 50` truthiness bug that
    // previously made the documented "set to 0" override a silent no-op.
    //
    // Per-account freshness skip: if `lastFetchedFromSource['glean-mcp']`
    // is < GLEAN_FRESHNESS_HOURS (default 24h) old, skip this account's
    // ~4 Glean searches. Account plans and recent meetings change slowly;
    // the orchestrator's last-write-wins merge keeps the prior snapshot's
    // data intact for skipped accounts. Bypass: FORCE_REFRESH=1.
    //
    // Cost shape: each account = ~4 Glean searches (1 plan-context after
    // the secondary-query removal in this same change + 3 evidence
    // sources). At the new rate-limiter ceiling of ~10 req/s aggregate
    // shared with cerebro+gainsight, a cold-cache run of 347 accounts
    // ≈ 140s for glean-mcp alone; a warm-cache run is near-zero.
    const limit = resolveGleanEnrichLimit();
    const scoped = limit > 0 ? allAccounts.slice(0, limit) : allAccounts;
    const priorAccounts = scoped.filter(
      (a) => !isFreshEnoughToSkip(a.lastFetchedFromSource?.['glean-mcp']),
    );
    const skippedFresh = scoped.length - priorAccounts.length;
    if (priorAccounts.length === 0) {
      log?.info('glean-mcp.skip', {
        reason: 'all accounts within freshness window',
        scopedAccounts: scoped.length,
        skippedFresh,
      });
      return { accounts: [], opportunities: [] };
    }

    const client = new GleanClient(creds);
    log?.info('glean-mcp.start', {
      accountCount: priorAccounts.length,
      scopedAccounts: scoped.length,
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
        const input = {
          accountId: account.accountId,
          accountName: account.accountName,
          salesforceSlackChannelUrl: account.salesforceSlackChannelUrl,
          // Lets fetchAccountContext skip the secondary QBR query when
          // this account already has plan coverage from a prior snapshot.
          priorPlanLinks: account.accountPlanLinks?.length ?? 0,
        };
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
        applyContextAndEvidenceToAccount(
          patch,
          context,
          evidence,
          refreshAt,
          account.recentMeetings,
        );
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

export { fetchAccountContext } from './account-context.js';
export { fetchAccountEvidence, applyContextAndEvidenceToAccount } from './evidence.js';
export default gleanMcpAdapter;

// Cerebro adapter via Glean federated search (datasource: `cerebro`).
//
// Cerebro has NO REST API — Glean is the only access path. This adapter
// enriches Account records already produced by Salesforce / localSnapshots
// with Cerebro's structured health-risk data:
//
//   ✅ cerebroRisks: 7 booleans (Engagement / Expertise / LegacyTech /
//      Pricing / Share / Suite / Utilization Risk)
//   ✅ cerebroSubMetrics: parsed from snippet text where Cerebro's
//      Health Risk page surfaces them as labeled values (Dso, Executive
//      Meeting Count, etc.)
//   ❌ cerebroRiskCategory + cerebroRiskAnalysis — NOT in Glean's Cerebro
//      index. Scoring layer's fallback path activates per Section 10
//      of the refactor prompt.
//
// Transport posture: Glean's MCP `search` tool ignores facetFilters and
// datasources args (those exist only on the admin-scoped REST API). To
// reach Cerebro docs without admin REST access, this adapter does a
// per-account keyword search ("cerebro <accountName>") and filters
// returned docs to `datasource: cerebro`. matchingFilters embedded in
// the search response carries the canonical risk/ID fields the mapper
// needs — no follow-up read_document call is required.
//
// Per-refresh behavior:
//   - Read GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL; return empty if missing.
//   - Discover account set from prior snapshot.
//   - For each account, search "cerebro <accountName>" with bounded
//     concurrency (CEREBRO_CONCURRENCY, default 5).
//   - Filter results to cerebro datasource; map each → Account partial.
//   - Group by SFDC accountId so multi-doc Best Buy (Canada/Purchasing/…)
//     each emit their own enrichment.

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
  resolveGleanClient,
  resolveGleanEnrichLimit,
  type GleanDocument,
} from '../../_shared/src/glean.js';
import { mapCerebroDocument } from './mapper.js';

export const isReadOnly: true = true;

// Per-account loop hits Glean's MCP `search` tool once per account.
// At concurrency 5 the worker collides with itself + the gainsight +
// glean-mcp adapters and triggers Glean's "Elastic rate limit exceeded"
// throttle. Concurrency 2 keeps us under the limit and lets the
// retry-with-backoff path in GleanClient absorb occasional spikes.
const DEFAULT_CONCURRENCY = 2;

/**
 * True if this snapshot of the account already carries Cerebro signal
 * (Risk Category or any of the 7 risk booleans). Used to prioritise
 * accounts that have **no** Cerebro data when an operator caps the scan.
 */
function hasAnyCerebroSignal(a: CanonicalAccount): boolean {
  if (a.cerebroRiskCategory) return true;
  const r = a.cerebroRisks;
  if (!r) return false;
  return Object.values(r).some((v) => v === true);
}

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
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

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
    // Use `||` not `??` because docker-compose forwards unset host env
    // vars as empty strings, and `Number("")` is 0 — which would mean
    // zero workers and a silent no-op.
    const concurrency =
      Number(process.env.CEREBRO_CONCURRENCY) || DEFAULT_CONCURRENCY;

    // Discover the account set from the prior successful snapshot.
    //
    // Fast path: when the orchestrator prefetched the prior snapshot
    // (ctx.priorRun) we skip both the metadata lookup and the JSONB
    // read entirely — three Glean adapters running in parallel used to
    // issue three identical 600KB reads of the same prior snapshot.
    let allAccounts: CanonicalAccount[];
    if (ctx?.priorRun) {
      allAccounts = ctx.priorRun.accounts;
    } else {
      const prior = await latestSuccessfulRun();
      if (!prior) {
        log?.info('cerebro.skip', { reason: 'no prior snapshot' });
        return { accounts: [], opportunities: [] };
      }
      allAccounts = await readSnapshotAccounts(prior.id);
    }
    if (allAccounts.length === 0) {
      log?.info('cerebro.skip', { reason: 'prior snapshot has no accounts' });
      return { accounts: [], opportunities: [] };
    }
    // Enrichment scope: by default cover **every** Expand 3 account so
    // the manager-facing forecast script does not emit "no Cerebro data"
    // rationales (downstream symptom observed 2026-05-13).
    //
    // Operator override: `GLEAN_ENRICH_LIMIT=N` (positive integer) caps
    // the scan for emergency throttling. When a cap is set we prioritise
    // accounts most likely to need data: those without any cerebroRisks
    // signal yet, then by ARR. This makes a small cap useful instead of
    // arbitrary. resolveGleanEnrichLimit() is shared with glean-mcp +
    // gainsight so all three adapters agree on what the env var means
    // (and correctly handle `GLEAN_ENRICH_LIMIT=0` as "no cap").
    //
    // Per-account freshness skip: if `lastFetchedFromSource.cerebro` is
    // < GLEAN_FRESHNESS_HOURS (default 24h) old, skip this account's
    // search. Cerebro health-risk pages change slowly (weekly at most);
    // this turns a same-day re-refresh into a near-no-op. Bypass:
    // FORCE_REFRESH=1.
    const limit = resolveGleanEnrichLimit();
    const scoped =
      limit === 0
        ? allAccounts
        : [...allAccounts]
            .sort((a, b) => {
              const aHas = hasAnyCerebroSignal(a) ? 1 : 0;
              const bHas = hasAnyCerebroSignal(b) ? 1 : 0;
              if (aHas !== bHas) return aHas - bHas; // missing first
              return (b.allTimeARR ?? 0) - (a.allTimeARR ?? 0);
            })
            .slice(0, limit);
    const priorAccounts = scoped.filter(
      (a) => !isFreshEnoughToSkip(a.lastFetchedFromSource?.cerebro),
    );
    const restCoverage = new Set(ctx?.cerebroRestCoverage?.enrichedAccountIds ?? []);
    const restAttempted = ctx?.cerebroRestCoverage?.restAttempted ?? false;
    const skippedRestCovered = priorAccounts.filter((a) => restCoverage.has(a.accountId)).length;
    const toSearch = priorAccounts.filter((a) => !restCoverage.has(a.accountId));
    const skippedFresh = scoped.length - priorAccounts.length;
    if (toSearch.length === 0) {
      log?.info('cerebro.skip', {
        reason: restAttempted
          ? 'cerebro-rest covered all accounts needing enrichment'
          : 'all accounts within freshness window',
        scopedAccounts: scoped.length,
        skippedFresh,
        skippedRestCovered,
        restAttempted,
      });
      return { accounts: [], opportunities: [] };
    }

    log?.info('cerebro.start', {
      accountCount: toSearch.length,
      scopedAccounts: scoped.length,
      skippedFresh,
      skippedRestCovered,
      restAttempted,
      concurrency,
    });
    const startedAt = Date.now();

    // Per-account search. Each search returns up to ~26 cross-datasource
    // docs from Glean; we filter to cerebro and keep the (typically 1-2)
    // health-risk pages that match this account.
    const startedSearches = Date.now();
    let searchFailures = 0;
    const allDocs: GleanDocument[] = [];
    let cerebroProcessed = 0;
    const perAccount = await mapWithConcurrency(
      toSearch,
      concurrency,
      async (account: CanonicalAccount): Promise<GleanDocument[]> => {
        ctx?.reportProgress?.(++cerebroProcessed, toSearch.length, account.accountName);
        try {
          const resp = await client.search({
            // SHORT keywords per Glean MCP tool guidance — no quotes,
            // no boolean operators.
            query: `cerebro ${account.accountName}`,
          });
          const docs = resp.documents ?? resp.results ?? [];
          return docs.filter(
            (d) =>
              d.datasource === 'cerebro' ||
              d.matchingFilters?.app?.includes('cerebro') === true ||
              (d.url ?? '').includes('cerebro'),
          );
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
    for (const docs of perAccount) allDocs.push(...docs);

    log?.info('cerebro.search.complete', {
      searchedAccounts: toSearch.length,
      searchFailures,
      docCount: allDocs.length,
      durationMs: Date.now() - startedSearches,
    });

    if (allDocs.length === 0) {
      return { accounts: [], opportunities: [] };
    }

    // Map each doc → Account partial. Group by accountId in case Glean
    // returns multiple variants for the same SFDC account (we keep the
    // most recent merge).
    const byAccount = new Map<string, CanonicalAccount>();
    let mapped = 0;
    let unmapped = 0;
    const seenUrls = new Set<string>();
    for (const doc of allDocs) {
      // Per-account searches produce overlapping result sets (one
      // account's search may surface another's Cerebro page). Dedupe
      // by URL to avoid double-mapping.
      if (doc.url) {
        if (seenUrls.has(doc.url)) continue;
        seenUrls.add(doc.url);
      }
      const rec = mapCerebroDocument(doc, { refreshAt });
      if (!rec) {
        unmapped += 1;
        continue;
      }
      mapped += 1;
      const existing = byAccount.get(rec.accountId);
      const partial: Partial<CanonicalAccount> = existing
        ? { ...existing, ...rec.patch }
        : rec.patch;
      byAccount.set(rec.accountId, {
        ...(partial as CanonicalAccount),
        accountId: rec.accountId,
      });
    }

    log?.info('cerebro.complete', {
      mapped,
      unmapped,
      uniqueAccounts: byAccount.size,
      durationMs: Date.now() - startedAt,
    });

    return { accounts: Array.from(byAccount.values()), opportunities: [] };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    const client = resolveGleanClient(undefined, creds);
    return client!.healthCheck();
  },
};

export default cerebroGleanAdapter;

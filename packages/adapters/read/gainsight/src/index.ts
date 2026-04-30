// Gainsight read-only adapter via Glean's `app:gainsight` datasource.
//
// Gainsight is the System of Record for CSE Sentiment. It pushes that
// value to Salesforce, Cerebro, and Clari — MDAS reads sentiment from
// SFDC (cheaper, already on the canonical record). What this adapter
// adds is the structured CTA / Task surface Salesforce does not carry:
// `gainsightTasks` (owner + dueDate + status + priority + type) for
// the Account Drill-In's "Next actions" panel.
//
// Cross-system join: Glean's Gainsight connector exposes
// `gscompanyname` and `gscompanygsid` (Gainsight internal ID) as facets,
// but NOT the SFDC Account ID. The adapter joins to canonical by
// case-insensitive name match (with a normalize() that strips ", Inc.",
// ", LLC", "GmbH", etc.) against the prior snapshot's accountName.
// Unmatched CTAs are logged at info level and dropped.
//
// Per-refresh behavior:
//   - Read GLEAN_MCP_* env. Return empty if missing.
//   - One paginated Glean search across `app:gainsight` filtered to
//     `type:calltoaction`. Single sweep, no per-account loop.
//   - Map → GainsightCtaMapped, group by normalized account name.
//   - Read prior snapshot Account list, build name → accountId index.
//   - Emit Account partials with gainsightTasks set, plus a SourceLink
//     per CTA and lastFetchedFromSource['gainsight'] freshness stamp.
import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
  SourceLink,
} from '@mdas/canonical';
import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { GleanClient, readGleanCredsFromEnv } from '../../_shared/src/glean.js';
import { mapGainsightCta, normalizeName, type GainsightCtaMapped } from './mapper.js';

export const isReadOnly: true = true;

export const gainsightAdapter: ReadAdapter = {
  name: 'gainsight',
  source: 'gainsight',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { accounts: [], opportunities: [] };

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;

    // Build a normalized-name → accountId lookup from the prior snapshot.
    const prior = await latestSuccessfulRun();
    if (!prior) {
      log?.info('gainsight.skip', { reason: 'no prior snapshot' });
      return { accounts: [], opportunities: [] };
    }
    const allAccounts = await readSnapshotAccounts(prior.id);
    // Cap enrichment scope. With Glean's per-minute rate limit + the
    // process-wide concurrency gate in GleanClient, ~300 accounts × 3
    // adapters would push the refresh past 10 minutes. Default 100,
    // overridable via GLEAN_ENRICH_LIMIT (set 0 to disable cap).
    const limit = Number(process.env.GLEAN_ENRICH_LIMIT) || 50;
    const priorAccounts = limit > 0 ? allAccounts.slice(0, limit) : allAccounts;
    const nameToAccountId = new Map<string, string>();
    for (const a of priorAccounts) {
      nameToAccountId.set(normalizeName(a.accountName), a.accountId);
    }
    if (nameToAccountId.size === 0) {
      log?.info('gainsight.skip', { reason: 'prior snapshot had no accounts' });
      return { accounts: [], opportunities: [] };
    }

    const client = new GleanClient(creds);
    // Concurrency 2 to share Glean's rate-limit budget with cerebro +
    // glean-mcp. See GleanClient's retry-with-backoff for the upstream
    // safety net.
    // Use `||` not `??` because docker-compose forwards unset host env
    // vars as empty strings; Number("") is 0 → zero workers → no-op.
    const concurrency = Number(process.env.GAINSIGHT_CONCURRENCY) || 2;

    // MCP search ignores datasources / facetFilters — those are
    // admin-scoped REST args. Per-account keyword search is the only
    // path that surfaces Gainsight CTAs; we then filter to the
    // gainsight datasource via the matchingFilters / datasource
    // fields embedded in each result.
    log?.info('gainsight.start', {
      accountCount: priorAccounts.length,
      concurrency,
    });
    const startedAt = Date.now();
    let searchFailures = 0;
    const docsAccum: Awaited<ReturnType<typeof client.search>>['documents'] = [];

    const perAccount = await Promise.all(
      // Bounded concurrency via simple promise-array slicing — gainsight
      // adapter doesn't import the helper from glean-mcp; this is small
      // enough to inline.
      (() => {
        const results: Promise<void>[] = [];
        let cursor = 0;
        const work = async (): Promise<void> => {
          while (cursor < priorAccounts.length) {
            const i = cursor++;
            const account = priorAccounts[i]!;
            try {
              const resp = await client.search({
                query: `gainsight CTA ${account.accountName}`,
              });
              const found = (resp.documents ?? resp.results ?? []).filter(
                (d) =>
                  d.datasource === 'gainsight' ||
                  d.matchingFilters?.app?.includes('gainsight') === true ||
                  (d.url ?? '').includes('gainsight'),
              );
              docsAccum.push(...found);
            } catch (err) {
              searchFailures += 1;
              log?.warn('gainsight.search.account.failed', {
                accountId: account.accountId,
                error: (err as Error).message,
              });
            }
          }
        };
        for (let w = 0; w < Math.min(concurrency, priorAccounts.length); w++) {
          results.push(work());
        }
        return results;
      })(),
    );
    void perAccount;

    // Dedupe by URL — overlapping per-account searches surface the same
    // CTA more than once.
    const seenUrls = new Set<string>();
    const docs = docsAccum.filter((d) => {
      if (!d.url) return true;
      if (seenUrls.has(d.url)) return false;
      seenUrls.add(d.url);
      return true;
    });
    log?.info('gainsight.search.complete', {
      searchedAccounts: priorAccounts.length,
      searchFailures,
      docCount: docs.length,
      durationMs: Date.now() - startedAt,
    });

    // Bucket CTAs by normalized account name.
    const ctasByAccountName = new Map<string, GainsightCtaMapped[]>();
    let unmappable = 0;
    for (const doc of docs) {
      const mapped = mapGainsightCta(doc);
      if (!mapped) {
        unmappable += 1;
        continue;
      }
      const list = ctasByAccountName.get(mapped.normalizedName);
      if (list) list.push(mapped);
      else ctasByAccountName.set(mapped.normalizedName, [mapped]);
    }

    // Match buckets to canonical accountIds and emit partials.
    const accounts: Partial<CanonicalAccount>[] = [];
    let matched = 0;
    let unmatched = 0;
    for (const [normName, ctas] of ctasByAccountName) {
      const accountId = nameToAccountId.get(normName);
      if (!accountId) {
        unmatched += 1;
        continue;
      }
      matched += 1;
      // Sort: open first, then by due date ascending (nulls last). Cap
      // at 25 per account so a noisy company doesn't blow out canonical.
      const sorted = ctas.slice().sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        const ad = a.task.dueDate ?? '9999';
        const bd = b.task.dueDate ?? '9999';
        return ad.localeCompare(bd);
      });
      const top = sorted.slice(0, 25);

      const sourceLinks: SourceLink[] = top
        .filter((c) => c.url)
        .map((c) => ({
          source: 'gainsight',
          label: `CTA: ${c.task.title}`,
          url: c.url ?? '',
        }));

      accounts.push({
        accountId,
        gainsightTasks: top.map((c) => c.task),
        sourceLinks,
        lastFetchedFromSource: { gainsight: refreshAt.toISOString() },
      });
    }

    log?.info('gainsight.mapped', {
      ctaDocsTotal: docs.length,
      ctaDocsUnmappable: unmappable,
      accountsMatched: matched,
      accountsUnmatched: unmatched,
    });

    return {
      accounts: accounts as CanonicalAccount[],
      opportunities: [],
    };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    return new GleanClient(creds).healthCheck();
  },
};

export default gainsightAdapter;

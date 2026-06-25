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
//   - Franchise-wide paginated Glean sweep (not per-account loop).
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
import {
  isFreshEnoughToSkip,
  readGleanCredsFromEnv,
  resolveGleanClient,
  resolveGleanEnrichLimit,
} from '../../_shared/src/glean.js';
import { mapGainsightCta, normalizeName, type GainsightCtaMapped } from './mapper.js';
import { fetchGainsightCtaDocuments } from './sweep.js';

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
    const client = resolveGleanClient(ctx, creds);
    if (!client) return { accounts: [], opportunities: [] };

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;

    let allAccounts: CanonicalAccount[];
    if (ctx?.priorRun) {
      allAccounts = ctx.priorRun.accounts;
    } else {
      const prior = await latestSuccessfulRun();
      if (!prior) {
        log?.info('gainsight.skip', { reason: 'no prior snapshot' });
        return { accounts: [], opportunities: [] };
      }
      allAccounts = await readSnapshotAccounts(prior.id);
    }

    const limit = resolveGleanEnrichLimit();
    const scoped = limit > 0 ? allAccounts.slice(0, limit) : allAccounts;
    const needsRefresh = scoped.filter(
      (a) => !isFreshEnoughToSkip(a.lastFetchedFromSource?.gainsight),
    );
    const skippedFresh = scoped.length - needsRefresh.length;
    const needsRefreshIds = new Set(needsRefresh.map((a) => a.accountId));

    const nameToAccountId = new Map<string, string>();
    for (const a of scoped) {
      if (!a.accountName) continue;
      nameToAccountId.set(normalizeName(a.accountName), a.accountId);
    }
    if (nameToAccountId.size === 0) {
      log?.info('gainsight.skip', { reason: 'prior snapshot had no accounts' });
      return { accounts: [], opportunities: [] };
    }
    if (needsRefresh.length === 0) {
      log?.info('gainsight.skip', {
        reason: 'all accounts within freshness window',
        scopedAccounts: scoped.length,
        skippedFresh,
      });
      return { accounts: [], opportunities: [] };
    }

    log?.info('gainsight.start', {
      mode: 'franchise-sweep',
      accountsNeedingRefresh: needsRefresh.length,
      scopedAccounts: scoped.length,
      skippedFresh,
    });
    const startedAt = Date.now();
    ctx?.reportProgress?.(0, 1, 'Gainsight CTA sweep');

    const { docs, searchCalls } = await fetchGainsightCtaDocuments(client);
    ctx?.reportProgress?.(1, 1, 'Gainsight CTA sweep');

    log?.info('gainsight.search.complete', {
      mode: 'franchise-sweep',
      searchCalls,
      docCount: docs.length,
      durationMs: Date.now() - startedAt,
    });

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

    const accounts: Partial<CanonicalAccount>[] = [];
    let matched = 0;
    let unmatched = 0;
    for (const [normName, ctas] of ctasByAccountName) {
      const accountId = nameToAccountId.get(normName);
      if (!accountId) {
        unmatched += 1;
        continue;
      }
      if (!needsRefreshIds.has(accountId)) continue;

      matched += 1;
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
    const client = resolveGleanClient(undefined, creds);
    return client!.healthCheck();
  },
};

export default gainsightAdapter;

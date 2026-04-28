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
    const priorAccounts = await readSnapshotAccounts(prior.id);
    const nameToAccountId = new Map<string, string>();
    for (const a of priorAccounts) {
      nameToAccountId.set(normalizeName(a.accountName), a.accountId);
    }
    if (nameToAccountId.size === 0) {
      log?.info('gainsight.skip', { reason: 'prior snapshot had no accounts' });
      return { accounts: [], opportunities: [] };
    }

    const client = new GleanClient(creds);

    let docs;
    try {
      docs = await client.searchAll({
        query: '*',
        datasources: ['gainsight'],
        facetFilters: [
          { fieldName: 'type', values: [{ value: 'calltoaction', relationType: 'EQUALS' }] },
        ],
        pageSize: 100,
      });
    } catch (err) {
      log?.error('gainsight.search.failed', { error: (err as Error).message });
      return { accounts: [], opportunities: [] };
    }
    log?.info('gainsight.search.complete', { docCount: docs.length });

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

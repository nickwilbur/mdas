// Cerebro adapter via Glean federated search (datasource: `cerebro`).
//
// Cerebro has NO REST API — Glean is the only access path. This adapter
// enriches Account records already produced by Salesforce / localSnapshots
// with Cerebro's structured health-risk data:
//
//   ✅ cerebroRisks: 7 booleans (Engagement / Expertise / LegacyTech /
//      Pricing / Share / Suite / Utilization Risk)
//   ✅ cerebroSubMetrics: Projected Billing/Revenue Utilization %,
//      Executive Meeting Count, Billing/Revenue Product Share %, Orders
//      API Usage %, plus has-flags (ESA / Invoice Settlement / TAM / UNO)
//   ❌ cerebroRiskCategory + cerebroRiskAnalysis — NOT in Glean's Cerebro
//      index. Verified via mcp2_search + mcp2_read_document on
//      2026-04-28. These two fields appear to live in a curated weekly
//      Google Sheet ("Cerebro Accounts with NASE") — see
//      docs/integrations/cerebro.md for the rationale and the planned
//      separate adapter (PR-4.b future work). Until that lands, the
//      scoring layer's RiskIdentifier { source: 'fallback' } path
//      activates per Section 10 of the refactor prompt — the only
//      legitimate place a derivation happens.
//
// Per-refresh behavior:
//   - Read GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL; return empty if missing.
//   - One paginated search across `app:cerebro type:healthrisk` for the
//     full corpus. Followed by getDocuments() for each result URL to
//     access richDocumentData.facets where the canonical-cased field
//     names live.
//   - Map each doc → { accountId, patch } and emit Account partials.

import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
} from '@mdas/canonical';
import { GleanClient, readGleanCredsFromEnv } from '../../_shared/src/glean.js';
import { mapCerebroDocument } from './mapper.js';

export const isReadOnly: true = true;

export const cerebroGleanAdapter: ReadAdapter = {
  name: 'cerebro-glean',
  source: 'cerebro',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readGleanCredsFromEnv();
    if (!creds) {
      // No-op when not configured — worker proceeds with localSnapshots etc.
      return { accounts: [], opportunities: [] };
    }
    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;
    const client = new GleanClient(creds);

    let docs;
    try {
      // First pass: search-paginate the entire app:cerebro / type:healthrisk
      // corpus to enumerate URLs. Snippets here have lowercase field keys.
      docs = await client.searchAll({
        query: '*',
        datasources: ['cerebro'],
        facetFilters: [
          { fieldName: 'type', values: [{ value: 'healthrisk', relationType: 'EQUALS' }] },
        ],
        pageSize: 100,
      });
    } catch (err) {
      log?.error('cerebro.search.failed', { error: (err as Error).message });
      return { accounts: [], opportunities: [] };
    }

    log?.info('cerebro.search.complete', { docCount: docs.length });

    if (docs.length === 0) {
      return { accounts: [], opportunities: [] };
    }

    // Second pass: getDocuments() for each URL to retrieve richDocumentData
    // (canonical-cased keys + intFacets). Glean's getdocument batches up to
    // ~100 URLs per call; chunk to be safe.
    const urls = docs.map((d) => d.url).filter((u): u is string => !!u);
    const fullDocs: typeof docs = [];
    const CHUNK = 50;
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK);
      try {
        const fetched = await client.getDocuments(chunk);
        fullDocs.push(...fetched);
      } catch (err) {
        log?.warn('cerebro.getDocument.chunk.failed', {
          chunkStart: i,
          chunkSize: chunk.length,
          error: (err as Error).message,
        });
      }
    }

    // 3) Map each doc → Account partial. Group by accountId in case Glean
    //    returns multiple variants for the same SFDC account (we keep the
    //    most recent).
    const byAccount = new Map<string, CanonicalAccount>();
    let mapped = 0;
    let unmapped = 0;
    for (const doc of fullDocs) {
      const rec = mapCerebroDocument(doc, { refreshAt });
      if (!rec) {
        unmapped += 1;
        continue;
      }
      mapped += 1;
      // Merge if multiple Cerebro docs target the same Account ID.
      const existing = byAccount.get(rec.accountId);
      const partial: Partial<CanonicalAccount> = existing
        ? { ...existing, ...rec.patch }
        : rec.patch;
      // The accountId is required by mergeAdapterResults to key the merge.
      // Cast acknowledges we're emitting Partial<CanonicalAccount> the
      // worker will merge onto a fuller record from prior adapters.
      byAccount.set(rec.accountId, {
        ...(partial as CanonicalAccount),
        accountId: rec.accountId,
      });
    }

    log?.info('cerebro.mapped', { mapped, unmapped });

    return { accounts: Array.from(byAccount.values()), opportunities: [] };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readGleanCredsFromEnv();
    if (!creds) return { ok: false, details: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set' };
    const client = new GleanClient(creds);
    return client.healthCheck();
  },
};

export default cerebroGleanAdapter;

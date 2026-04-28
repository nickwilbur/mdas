// Cerebro adapter via Glean federated search (Cerebro custom data source).
// Cerebro has NO REST API — Glean MCP search is the only access path.
// This adapter does not produce CanonicalAccount records on its own; it
// enriches accounts already produced by Salesforce with Cerebro Risk Category,
// Risk Analysis text, the 7 risk booleans, and sub-metrics.
//
// In v0 with no real Cerebro deployment, this adapter returns no records.

import type { ReadAdapter, AdapterFetchResult, RefreshContext } from '@mdas/canonical';
import { readOnlyGuard } from '../../_shared/src/index.js';

export const isReadOnly: true = true;

export const cerebroGleanAdapter: ReadAdapter = {
  name: 'cerebro-glean',
  source: 'cerebro',
  isReadOnly: true,
  async fetch(_input: { franchise: string }, _ctx?: RefreshContext): Promise<Partial<AdapterFetchResult>> {
    // Real implementation calls Glean MCP `search` against the Cerebro custom
    // data source for each Expand 3 account name and parses the document into
    // CanonicalAccount.cerebroRiskCategory / cerebroRiskAnalysis / cerebroRisks /
    // cerebroSubMetrics. Stubbed for v0.
    if (!process.env.GLEAN_MCP_TOKEN || !process.env.GLEAN_MCP_BASE_URL) {
      return {};
    }
    // Smoke check the guard; do not return data until mapping lands.
    try {
      await readOnlyGuard(`${process.env.GLEAN_MCP_BASE_URL}/rest/api/v1/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.GLEAN_MCP_TOKEN}`,
        },
        body: JSON.stringify({ query: 'Cerebro Risk Category Expand 3', pageSize: 1 }),
      });
    } catch {
      // Swallow: real adapters must not crash refresh.
    }
    return {};
  },
};

export default cerebroGleanAdapter;

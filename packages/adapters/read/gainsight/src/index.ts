// Gainsight read-only adapter via Glean native Gainsight connector (Beta).
// Gainsight is the System of Record for CSE Sentiment; it pushes the value to
// Salesforce, Cerebro, and Clari. MDAS reads sentiment from SFDC for query
// performance, but uses Gainsight Task records as the source of structured
// next-action items (owner + dueDate), which Salesforce Opportunity does not have.

import type { ReadAdapter, AdapterFetchResult } from '@mdas/canonical';
import { readOnlyGuard } from '../../_shared/src/index.js';

export const isReadOnly: true = true;

export const gainsightAdapter: ReadAdapter = {
  name: 'gainsight',
  isReadOnly: true,
  async fetch(): Promise<Partial<AdapterFetchResult>> {
    if (!process.env.GLEAN_MCP_TOKEN || !process.env.GLEAN_MCP_BASE_URL) {
      return {};
    }
    try {
      // Real impl: Glean MCP search across Gainsight Company / CTA / Task /
      // Relationship / Activity records, parse out structured task fields,
      // and merge into CanonicalAccount.gainsightTasks. Stubbed for v0.
      await readOnlyGuard(`${process.env.GLEAN_MCP_BASE_URL}/rest/api/v1/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.GLEAN_MCP_TOKEN}`,
        },
        body: JSON.stringify({ query: 'Gainsight Task Expand 3', pageSize: 1 }),
      });
    } catch {
      /* swallow */
    }
    return {};
  },
};

export default gainsightAdapter;

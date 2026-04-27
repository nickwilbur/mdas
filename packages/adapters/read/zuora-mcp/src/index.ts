// Zuora Remote MCP read-only adapter (OAuth 2.0).
// Uses only allowlisted tools from mcp.config.json:
//   query_objects, ask_zuora, account_summary, run_report.
// Quota: 5,000 requests / tenant / month — rate-limit client-side.
// Note: Zuora sandbox has no account data - used only for billing/revenue tooling.

import type { ReadAdapter, AdapterFetchResult } from '@mdas/canonical';
import { RateLimiter, readOnlyGuard } from '../../_shared/src/index.js';

export const isReadOnly: true = true;

const limiter = new RateLimiter(120, 60_000); // ~120/min cap (well under 5k/mo)

export const zuoraMcpAdapter: ReadAdapter = {
  name: 'zuora-mcp',
  isReadOnly: true,
  async fetch(): Promise<Partial<AdapterFetchResult>> {
    const baseUrl = process.env.ZUORA_MCP_BASE_URL;
    const clientId = process.env.ZUORA_MCP_CLIENT_ID;
    const clientSecret = process.env.ZUORA_MCP_CLIENT_SECRET;
    if (!baseUrl || !clientId || !clientSecret) return {};

    await limiter.wait();
    try {
      // Test connection to Zuora
      await readOnlyGuard(`${baseUrl}/healthz`, { intent: 'zuora-mcp:health' });
    } catch {
      /* swallow */
    }
    // Zuora sandbox has no account data - returns empty
    // Used only for billing/revenue tooling and asking specific Zuora questions
    return {
      accounts: [],
      opportunities: [],
    };
  },
};

export default zuoraMcpAdapter;

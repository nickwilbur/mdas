// Glean MCP read-only adapter.
// Uses Glean MCP tools (search, chat, read_document) to fetch data.
// Fallback for everything, including understanding what accounts and opportunities are in 'Expand 3'.
// Used when Salesforce can't be reached or doesn't have the data.

import type { ReadAdapter, AdapterFetchResult, RefreshContext } from '@mdas/canonical';

export const isReadOnly: true = true;

export const gleanMcpAdapter: ReadAdapter = {
  name: 'glean-mcp',
  source: 'glean-mcp',
  isReadOnly: true,
  async fetch(input: { franchise: string }, _ctx?: RefreshContext): Promise<Partial<AdapterFetchResult>> {
    const { franchise } = input;
    void franchise; // referenced in commented-out implementation below
    const token = process.env.GLEAN_MCP_TOKEN;
    const baseUrl = process.env.GLEAN_MCP_BASE_URL;
    if (!token || !baseUrl) return {};

    try {
      // Use Glean MCP search to find accounts
      // Note: This would typically call the MCP search tool
      // For MVP, we'll simulate by returning empty since MCP tools aren't directly callable from adapter code
      // The MCP tools are meant to be used by the AI assistant (Cascade), not by the application code
      
      // In a real implementation, this would:
      // 1. Call mcp2_search with query: `${franchise} account`
      // 2. Parse results and map to CanonicalAccount
      // 3. Call mcp2_search with query: `${franchise} opportunity deal`
      // 4. Parse results and map to CanonicalOpportunity
      
      // For MVP, return empty since MCP tools need to be called from the AI assistant context
      return {
        accounts: [],
        opportunities: [],
      };
    } catch (error) {
      console.error('Glean MCP adapter error:', error);
      return {
        accounts: [],
        opportunities: [],
      };
    }
  },
};

export default gleanMcpAdapter;

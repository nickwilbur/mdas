// Glean MCP read-only adapter.
// All Glean MCP tools (search, chat, read_document) are read-only by design.
// Used for cross-source synthesis: account plans, decks, Slack channels,
// Gmail, Calendar, Zoom transcripts, Salesforce notes, Gainsight notes.

import type { ReadAdapter, AdapterFetchResult } from '@mdas/canonical';

export const isReadOnly: true = true;

export const gleanMcpAdapter: ReadAdapter = {
  name: 'glean-mcp',
  isReadOnly: true,
  async fetch(): Promise<Partial<AdapterFetchResult>> {
    if (!process.env.GLEAN_MCP_TOKEN) return {};
    // Real impl: enrich CanonicalAccount.accountPlanLinks and recentMeetings.
    return {};
  },
};

export default gleanMcpAdapter;

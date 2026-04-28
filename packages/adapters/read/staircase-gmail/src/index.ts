// Staircase.AI read-only adapter via Gmail (sender support@staircase.ai).
// No Glean-native Staircase connector exists. We pull supporting evidence
// (Owner / Tier / Renewal date / Revenue / Summary / Issues / Action Items / Topics)
// and merge into CanonicalAccount.recentMeetings as 'staircase' source.
// Treat as supporting evidence, not a system of record.

import type { ReadAdapter, AdapterFetchResult, RefreshContext } from '@mdas/canonical';

export const isReadOnly: true = true;

export const staircaseGmailAdapter: ReadAdapter = {
  name: 'staircase-gmail',
  source: 'staircase',
  isReadOnly: true,
  async fetch(_input: { franchise: string }, _ctx?: RefreshContext): Promise<Partial<AdapterFetchResult>> {
    // Real impl: Gmail API users.messages.list with q="from:support@staircase.ai newer_than:7d",
    // body parser for the structured Staircase email template.
    // Stubbed for v0.
    return {};
  },
};

export default staircaseGmailAdapter;

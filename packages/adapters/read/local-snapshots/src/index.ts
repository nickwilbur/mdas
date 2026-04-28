// Self-adapter: reads prior snapshots back from Postgres so the worker can
// diff vs. previous refresh runs without re-fetching from any external system.

import type { ReadAdapter, AdapterFetchResult, RefreshContext } from '@mdas/canonical';
import {
  latestSuccessfulRun,
  readSnapshotAccounts,
  readSnapshotOpportunities,
} from '@mdas/db';

export const isReadOnly: true = true;

export const localSnapshotsAdapter: ReadAdapter = {
  name: 'local-snapshots',
  source: 'local-snapshots',
  isReadOnly: true,
  async fetch(_input: { franchise: string }, _ctx?: RefreshContext): Promise<Partial<AdapterFetchResult>> {
    const last = await latestSuccessfulRun();
    if (!last) return { accounts: [], opportunities: [] };
    const accounts = await readSnapshotAccounts(last.id);
    const opportunities = await readSnapshotOpportunities(last.id);
    return { accounts, opportunities };
  },
};

export default localSnapshotsAdapter;

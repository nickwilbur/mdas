#!/usr/bin/env tsx
/**
 * Prune the latest MDAS snapshot to active Expand 3 accounts only.
 * Rewrites snapshot_account, snapshot_opportunity, and account_view
 * for the most recent successful refresh run.
 *
 * Usage: npx tsx scripts/prune-expand3-snapshot.ts
 */

import {
  latestSuccessfulRun,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  replaceSnapshotAccounts,
  replaceSnapshotOpportunities,
  replaceAccountViews,
  audit,
} from '@mdas/db';
import { filterExpand3Snapshot } from '@mdas/canonical';
import { buildAccountView, rankAccountViews } from '@mdas/scoring';

async function main(): Promise<void> {
  const run = await latestSuccessfulRun();
  if (!run) {
    console.error('No successful refresh run found.');
    process.exit(1);
  }

  const accounts = await readSnapshotAccounts(run.id);
  const opportunities = await readSnapshotOpportunities(run.id);
  const before = { accounts: accounts.length, opportunities: opportunities.length };

  const filtered = filterExpand3Snapshot({ accounts, opportunities });
  const after = {
    accounts: filtered.accounts.length,
    opportunities: filtered.opportunities.length,
  };

  if (after.accounts === before.accounts && after.opportunities === before.opportunities) {
    console.log('Snapshot already scoped to active Expand 3 — no changes.', before);
    return;
  }

  const oppsByAccount = new Map<string, typeof filtered.opportunities>();
  for (const o of filtered.opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }

  const views = rankAccountViews(
    filtered.accounts.map((a) => buildAccountView(a, oppsByAccount.get(a.accountId) ?? [])),
  );

  await replaceSnapshotAccounts(run.id, filtered.accounts);
  await replaceSnapshotOpportunities(run.id, filtered.opportunities);
  await replaceAccountViews(run.id, views);
  await audit('scripts/prune-expand3-snapshot', 'snapshot.pruned', {
    refreshId: run.id,
    before,
    after,
  });

  console.info(
    JSON.stringify({
      msg: 'expand3.snapshot.pruned',
      refreshId: run.id,
      before,
      after,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

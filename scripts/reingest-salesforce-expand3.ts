#!/usr/bin/env tsx
/**
 * Re-pull Salesforce Expand 3 accounts/opps into the latest successful
 * refresh snapshot using the current ingest rules (supplemental accounts,
 * churn-grid retention). Preserves Glean enrichments already on prior
 * accounts. Much faster than a full adapter refresh.
 *
 * Usage: npx tsx scripts/reingest-salesforce-expand3.ts
 */

import {
  audit,
  latestSuccessfulRun,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  replaceAccountViews,
  replaceSnapshotAccounts,
  replaceSnapshotOpportunities,
  updateRefreshTrajectoryKpis,
} from '@mdas/db';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { filterExpand3Snapshot } from '@mdas/canonical';
import { salesforceAdapter } from '@mdas/adapter-salesforce';
import { computeRefreshTrajectoryKpis } from '@mdas/forecast-generator';
import { applySalesforceAuthoritativeSnapshot } from '../apps/worker/src/salesforce-authoritative.js';
import { rankAccountViews } from '@mdas/scoring';
import { buildAccountViewWithDefaults } from '../apps/web/src/lib/account-defaults.ts';

function mergeAccounts(
  prior: CanonicalAccount[],
  incoming: CanonicalAccount[],
): CanonicalAccount[] {
  const byId = new Map(prior.map((a) => [a.accountId, a]));
  for (const a of incoming) {
    const existing = byId.get(a.accountId);
    byId.set(a.accountId, existing ? { ...existing, ...a } : a);
  }
  return [...byId.values()];
}

async function main(): Promise<void> {
  const run = await latestSuccessfulRun();
  if (!run) {
    console.error('No successful refresh run found.');
    process.exit(1);
  }

  const asOfDate = new Date(run.started_at).toISOString().slice(0, 10);
  const priorAccounts = await readSnapshotAccounts(run.id);
  const priorOpportunities = await readSnapshotOpportunities(run.id);
  const before = {
    accounts: priorAccounts.length,
    opportunities: priorOpportunities.length,
  };

  const sf = await salesforceAdapter.fetch(
    { franchise: 'Expand 3' },
    { asOf: new Date(run.started_at) },
  );
  const sfAccounts = sf.accounts ?? [];
  const sfOpportunities = sf.opportunities ?? [];
  if (sfAccounts.length === 0 && sfOpportunities.length === 0) {
    console.error('Salesforce returned no data — check SALESFORCE_* env vars.');
    process.exit(1);
  }

  let merged = {
    accounts: mergeAccounts(priorAccounts, sfAccounts),
    opportunities: priorOpportunities,
  };
  merged = applySalesforceAuthoritativeSnapshot(merged, sf, { asOfDate });
  merged = filterExpand3Snapshot(merged, { asOfDate });

  const after = {
    accounts: merged.accounts.length,
    opportunities: merged.opportunities.length,
  };

  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of merged.opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }

  const views = rankAccountViews(
    merged.accounts.map((a) =>
      buildAccountViewWithDefaults(a, oppsByAccount.get(a.accountId) ?? []),
    ),
  );

  await replaceSnapshotAccounts(run.id, merged.accounts);
  await replaceSnapshotOpportunities(run.id, merged.opportunities);
  await replaceAccountViews(run.id, views);
  await updateRefreshTrajectoryKpis(
    run.id,
    computeRefreshTrajectoryKpis(views, asOfDate),
  );
  await audit('scripts/reingest-salesforce-expand3', 'snapshot.salesforce.reingested', {
    refreshId: run.id,
    asOfDate,
    before,
    after,
  });

  console.info(
    JSON.stringify({
      msg: 'salesforce.expand3.reingested',
      refreshId: run.id,
      asOfDate,
      before,
      after,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

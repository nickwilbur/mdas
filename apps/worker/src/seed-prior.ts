// Seed a synthetic "prior" snapshot from mock fixtures so CI and local
// `npm run seed` produce a non-empty read model without live SFDC/Glean.
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import * as mockFixtures from '../../../packages/adapters/mock/src/fixtures.js';
import {
  completeRefreshRun,
  replaceAccountViews,
  startRefreshRun,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
} from '@mdas/db';
import { buildAccountView, rankAccountViews } from '@mdas/scoring';

async function persistSeedRun(
  accounts: CanonicalAccount[],
  opportunities: CanonicalOpportunity[],
): Promise<string> {
  const refreshId = await startRefreshRun({
    scoringVersion: 'v0.1.0',
    sources: ['seed:prior'],
  });
  await writeSnapshotAccounts(refreshId, accounts);
  await writeSnapshotOpportunities(refreshId, opportunities);

  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }
  const views = rankAccountViews(
    accounts.map((a) => buildAccountView(a, oppsByAccount.get(a.accountId) ?? [])),
  );
  await replaceAccountViews(refreshId, views);

  await completeRefreshRun(refreshId, 'success', {
    sourcesSucceeded: ['seed:prior'],
    rowCounts: {
      accounts: accounts.length,
      opportunities: opportunities.length,
      account_views: views.length,
      change_events: 0,
    },
  });
  return refreshId;
}

const getMockDataPrior =
  'getMockDataPrior' in mockFixtures
    ? (mockFixtures as { getMockDataPrior: () => { accounts: CanonicalAccount[]; opportunities: CanonicalOpportunity[] } })
        .getMockDataPrior
    : (
        mockFixtures as {
          default: { getMockDataPrior: () => { accounts: CanonicalAccount[]; opportunities: CanonicalOpportunity[] } };
        }
      ).default.getMockDataPrior;

const { accounts, opportunities } = getMockDataPrior();
const refreshId = await persistSeedRun(accounts, opportunities);
console.log(
  `[seed-prior] seeded ${accounts.length} accounts / ${opportunities.length} opportunities (refresh ${refreshId})`,
);

// Server-only read helpers. Pages read ONLY from local Postgres (account_view + snapshot_*).
import 'server-only';
import {
  latestSuccessfulRun,
  listRefreshRuns,
  previousSuccessfulRun,
  readAccountView,
  readAccountViews,
  readAuditLog,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  query,
} from '@mdas/db';
import type { AccountView, CanonicalOpportunity, ChangeEvent } from '@mdas/canonical';
import { diffAll } from '@mdas/scoring';

export async function getLatestRunId(): Promise<string | null> {
  const r = await latestSuccessfulRun();
  return r?.id ?? null;
}

export async function getDashboardData(): Promise<{
  views: AccountView[];
  refreshId: string | null;
  startedAt: string | null;
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { views: [], refreshId: null, startedAt: null };
  const views = await readAccountViews(run.id);
  views.sort((a, b) => a.priorityRank - b.priorityRank);
  return { views, refreshId: run.id, startedAt: run.started_at };
}

export async function getAccount(accountId: string): Promise<AccountView | null> {
  const run = await latestSuccessfulRun();
  if (!run) return null;
  return readAccountView(run.id, accountId);
}

export async function getWoWChangeEvents(): Promise<{
  events: ChangeEvent[];
  currId: string | null;
  prevId: string | null;
}> {
  const curr = await latestSuccessfulRun();
  if (!curr) return { events: [], currId: null, prevId: null };
  const prev = await previousSuccessfulRun(curr.id);
  if (!prev) return { events: [], currId: curr.id, prevId: null };

  const [currA, currO, prevA, prevO] = await Promise.all([
    readSnapshotAccounts(curr.id),
    readSnapshotOpportunities(curr.id),
    readSnapshotAccounts(prev.id),
    readSnapshotOpportunities(prev.id),
  ]);
  const events = diffAll(
    { accounts: prevA, opportunities: prevO },
    { accounts: currA, opportunities: currO },
    prev.id,
    curr.id,
  );
  return { events, currId: curr.id, prevId: prev.id };
}

export async function getRecentRuns(limit = 20) {
  return listRefreshRuns(limit);
}

export async function getAuditTail(limit = 80) {
  return readAuditLog(limit);
}

export async function getAllOpportunities(): Promise<{
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, string>;
  refreshId: string | null;
  startedAt: string | null;
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { opportunities: [], accounts: new Map(), refreshId: null, startedAt: null };
  const [opportunities, accountSnapshots] = await Promise.all([
    readSnapshotOpportunities(run.id),
    query<{ account_id: string; payload: { accountName?: string } }>(
      `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
      [run.id],
    ),
  ]);
  
  // Sort by close date
  opportunities.sort((a, b) => new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime());
  
  // Create account name map from snapshot accounts
  const accountMap = new Map<string, string>();
  for (const acc of accountSnapshots.rows) {
    accountMap.set(acc.account_id, acc.payload.accountName || acc.account_id);
  }
  
  return { opportunities, accounts: accountMap, refreshId: run.id, startedAt: run.started_at };
}

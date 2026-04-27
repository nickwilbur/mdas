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
} from '@mdas/db';
import type { AccountView, ChangeEvent } from '@mdas/canonical';
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

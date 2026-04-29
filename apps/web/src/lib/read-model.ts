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
  // Filter to only Expand 3 franchise
  const filteredViews = views.filter(v => v.account.franchise === 'Expand 3');
  filteredViews.sort((a, b) => a.priorityRank - b.priorityRank);
  return { views: filteredViews, refreshId: run.id, startedAt: run.started_at };
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

/**
 * Aggregate per-source freshness across all accounts in the most recent
 * successful run. Reads `payload->'lastFetchedFromSource'` from every
 * snapshot_account row and returns the most recent timestamp per source
 * plus the count of accounts that had data from that source.
 *
 * The previous implementation showed the run's completed_at for every
 * source, which masked partial failures (e.g. SF ran fine, but Cerebro
 * 401'd halfway through and only enriched 12/236 accounts). Now we
 * surface that asymmetry directly.
 */
export async function getPerSourceFreshness(): Promise<{
  refreshId: string | null;
  perSource: { source: string; latest: string | null; accountsTouched: number }[];
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { refreshId: null, perSource: [] };
  // jsonb_each_text yields (key, value) pairs from the freshness map.
  // Aggregate per key across all account rows in this refresh.
  const r = await query<{ source: string; latest: string | null; accounts_touched: string }>(
    `
    SELECT
      kv.key                         AS source,
      MAX(kv.value)                  AS latest,
      COUNT(DISTINCT s.account_id)   AS accounts_touched
    FROM snapshot_account s,
         LATERAL jsonb_each_text(COALESCE(s.payload->'lastFetchedFromSource', '{}'::jsonb)) AS kv
    WHERE s.refresh_id = $1
    GROUP BY kv.key
    ORDER BY kv.key
    `,
    [run.id],
  );
  return {
    refreshId: run.id,
    perSource: r.rows.map((row) => ({
      source: row.source,
      latest: row.latest,
      accountsTouched: Number(row.accounts_touched),
    })),
  };
}

export async function getAuditTail(limit = 80) {
  return readAuditLog(limit);
}

export async function getAllOpportunities(): Promise<{
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, import('@mdas/canonical').CanonicalAccount>;
  refreshId: string | null;
  startedAt: string | null;
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { opportunities: [], accounts: new Map(), refreshId: null, startedAt: null };
  const [opportunities, accountSnapshots] = await Promise.all([
    readSnapshotOpportunities(run.id),
    query<{ account_id: string; payload: import('@mdas/canonical').CanonicalAccount }>(
      `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
      [run.id],
    ),
  ]);

  // Filter: 36 months forward, 15 months trailing from today
  const now = new Date();
  const minDate = new Date(now);
  minDate.setMonth(minDate.getMonth() - 15);
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 36);

  const filteredOpps = opportunities.filter(opp => {
    const closeDate = new Date(opp.closeDate);
    return closeDate >= minDate && closeDate <= maxDate;
  });
  
  // Sort by close date
  filteredOpps.sort((a, b) => new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime());

  // Create account map from snapshot accounts
  const accountMap = new Map<string, import('@mdas/canonical').CanonicalAccount>();
  for (const acc of accountSnapshots.rows) {
    accountMap.set(acc.account_id, acc.payload);
  }

  return { opportunities: filteredOpps, accounts: accountMap, refreshId: run.id, startedAt: run.started_at };
}

#!/usr/bin/env tsx
/**
 * Backfill refresh_runs.trajectory_kpis for historical successful refreshes.
 *
 * After migration 0005, new worker refreshes populate this column
 * automatically. This script computes KPIs for older runs so
 * POST /api/forecast skips loading full snapshot JSONB per day.
 *
 * Usage:
 *   npx tsx scripts/backfill-trajectory-kpis.ts
 *   npx tsx scripts/backfill-trajectory-kpis.ts --dry-run
 *   npx tsx scripts/backfill-trajectory-kpis.ts --refresh-id <uuid>
 */

import type { AccountView, CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { computeRefreshTrajectoryKpis } from '@mdas/forecast-generator';
import {
  listAllSuccessfulRefreshRuns,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  updateRefreshTrajectoryKpis,
  audit,
  type RefreshRun,
} from '@mdas/db';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const refreshIdx = args.indexOf('--refresh-id');
const singleRefreshId = refreshIdx >= 0 ? args[refreshIdx + 1] : undefined;

function toIsoString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}

async function buildViewsForRun(refreshId: string): Promise<AccountView[]> {
  const [accounts, opportunities] = await Promise.all([
    readSnapshotAccounts(refreshId),
    readSnapshotOpportunities(refreshId),
  ]);
  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }
  const views: AccountView[] = [];
  for (const a of accounts) {
    if (a.franchise !== 'Expand 3') continue;
    views.push(buildAccountView(a, oppsByAccount.get(a.accountId) ?? []));
  }
  return views;
}

async function backfillRun(run: RefreshRun): Promise<boolean> {
  if (run.trajectory_kpis) return false;
  const asOfDate = toIsoString(run.started_at).slice(0, 10);
  const views = await buildViewsForRun(run.id);
  const kpis = computeRefreshTrajectoryKpis(views, asOfDate);
  if (!dryRun) {
    await updateRefreshTrajectoryKpis(run.id, kpis);
  }
  console.info(
    JSON.stringify({
      msg: dryRun ? 'trajectory_kpis.backfill.dry_run' : 'trajectory_kpis.backfill',
      refreshId: run.id,
      asOfDate,
      accountViews: views.length,
    }),
  );
  return true;
}

async function main(): Promise<void> {
  const runs = singleRefreshId
    ? (await listAllSuccessfulRefreshRuns()).filter((r) => r.id === singleRefreshId)
    : await listAllSuccessfulRefreshRuns();

  if (singleRefreshId && runs.length === 0) {
    console.error(`Refresh ${singleRefreshId} not found or not successful.`);
    process.exit(1);
  }

  let backfilled = 0;
  for (const run of runs) {
    try {
      if (await backfillRun(run)) backfilled += 1;
    } catch (err) {
      console.warn(
        JSON.stringify({
          msg: 'trajectory_kpis.backfill.failed',
          refreshId: run.id,
          error: (err as Error).message,
        }),
      );
    }
  }

  if (!dryRun && backfilled > 0) {
    await audit('scripts/backfill-trajectory-kpis', 'trajectory_kpis.backfilled', { backfilled });
  }

  console.info(JSON.stringify({ msg: 'trajectory_kpis.backfill.summary', dryRun, backfilled, total: runs.length }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

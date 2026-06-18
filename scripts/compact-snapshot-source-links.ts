#!/usr/bin/env tsx
/**
 * Dedupe bloated sourceLinks arrays in historical snapshot JSONB.
 *
 * Before mergeSourceLinks ran on every refresh, identical SFDC/Glean
 * citations accumulated without bound in snapshot_account and
 * snapshot_opportunity payloads — inflating memory on every worker
 * refresh and web read.
 *
 * Usage:
 *   npx tsx scripts/compact-snapshot-source-links.ts           # all runs
 *   npx tsx scripts/compact-snapshot-source-links.ts --dry-run
 *   npx tsx scripts/compact-snapshot-source-links.ts --refresh-id <uuid>
 */

import type { AccountView, CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { dedupeSourceLinksByUrl } from '@mdas/canonical';
import {
  auditSourceLinkBloat,
  listAllSuccessfulRefreshRuns,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  readAccountViews,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
  writeAccountViews,
  audit,
} from '@mdas/db';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const refreshIdx = args.indexOf('--refresh-id');
const singleRefreshId = refreshIdx >= 0 ? args[refreshIdx + 1] : undefined;

function compactAccount(a: CanonicalAccount): { next: CanonicalAccount; changed: boolean } {
  const before = a.sourceLinks?.length ?? 0;
  const sourceLinks = dedupeSourceLinksByUrl(a.sourceLinks);
  if (sourceLinks.length === before) return { next: a, changed: false };
  return { next: { ...a, sourceLinks }, changed: true };
}

function compactOpportunity(o: CanonicalOpportunity): { next: CanonicalOpportunity; changed: boolean } {
  const before = o.sourceLinks?.length ?? 0;
  const sourceLinks = dedupeSourceLinksByUrl(o.sourceLinks);
  if (sourceLinks.length === before) return { next: o, changed: false };
  return { next: { ...o, sourceLinks }, changed: true };
}

function compactView(v: AccountView): { next: AccountView; changed: boolean } {
  const acct = compactAccount(v.account);
  const opps = v.opportunities.map(compactOpportunity);
  const oppsChanged = opps.some((o) => o.changed);
  if (!acct.changed && !oppsChanged) return { next: v, changed: false };
  return {
    next: {
      ...v,
      account: acct.next,
      opportunities: opps.map((o) => o.next),
    },
    changed: true,
  };
}

async function compactRefresh(refreshId: string): Promise<{
  accountsTouched: number;
  oppsTouched: number;
  viewsTouched: number;
  linksRemoved: number;
}> {
  const [accounts, opportunities, views] = await Promise.all([
    readSnapshotAccounts(refreshId),
    readSnapshotOpportunities(refreshId),
    readAccountViews(refreshId),
  ]);

  let linksRemoved = 0;
  let accountsTouched = 0;
  const nextAccounts = accounts.map((a) => {
    const { next, changed } = compactAccount(a);
    if (changed) {
      accountsTouched += 1;
      linksRemoved += (a.sourceLinks?.length ?? 0) - (next.sourceLinks?.length ?? 0);
    }
    return next;
  });

  let oppsTouched = 0;
  const nextOpps = opportunities.map((o) => {
    const { next, changed } = compactOpportunity(o);
    if (changed) {
      oppsTouched += 1;
      linksRemoved += (o.sourceLinks?.length ?? 0) - (next.sourceLinks?.length ?? 0);
    }
    return next;
  });

  let viewsTouched = 0;
  const nextViews = views.map((v) => {
    const { next, changed } = compactView(v);
    if (changed) viewsTouched += 1;
    return next;
  });

  if (!dryRun && (accountsTouched > 0 || oppsTouched > 0 || viewsTouched > 0)) {
    await Promise.all([
      accountsTouched > 0 ? writeSnapshotAccounts(refreshId, nextAccounts) : Promise.resolve(),
      oppsTouched > 0 ? writeSnapshotOpportunities(refreshId, nextOpps) : Promise.resolve(),
      viewsTouched > 0 ? writeAccountViews(refreshId, nextViews) : Promise.resolve(),
    ]);
  }

  return { accountsTouched, oppsTouched, viewsTouched, linksRemoved };
}

async function main(): Promise<void> {
  console.info(JSON.stringify({ msg: 'snapshot.sourceLinks.audit.before', rows: await auditSourceLinkBloat(10) }));

  const runs = singleRefreshId
    ? [{ id: singleRefreshId }]
    : await listAllSuccessfulRefreshRuns();

  let totalLinksRemoved = 0;
  let refreshesTouched = 0;

  for (const run of runs) {
    const stats = await compactRefresh(run.id);
    if (stats.linksRemoved > 0 || stats.accountsTouched > 0) {
      refreshesTouched += 1;
      totalLinksRemoved += stats.linksRemoved;
      console.info(
        JSON.stringify({
          msg: dryRun ? 'snapshot.sourceLinks.compact.dry_run' : 'snapshot.sourceLinks.compact',
          refreshId: run.id,
          ...stats,
        }),
      );
    }
  }

  if (!dryRun && refreshesTouched > 0) {
    await audit('scripts/compact-snapshot-source-links', 'snapshot.sourceLinks.compacted', {
      refreshesTouched,
      totalLinksRemoved,
    });
  }

  console.info(
    JSON.stringify({
      msg: 'snapshot.sourceLinks.summary',
      dryRun,
      refreshesTouched,
      totalLinksRemoved,
    }),
  );
  console.info(JSON.stringify({ msg: 'snapshot.sourceLinks.audit.after', rows: await auditSourceLinkBloat(10) }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

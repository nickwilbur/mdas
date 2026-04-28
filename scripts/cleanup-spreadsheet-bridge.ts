// One-shot cleanup: undo the data injected by the (now-deleted)
// scripts/import-cerebro-fixture.ts bridge that read a Glean gdrive
// spreadsheet. Per "Data sources & precedence" in README.md, gdrive
// spreadsheets are not allowed as a data source for this pipeline.
//
// Markers of the spreadsheet-injected payload:
//   1. A sourceLink whose URL contains the spreadsheet doc ID
//      `1nhA-AFBQLAbHJpriuRLlpNC4GTQPQ0xISNhw8vFGfyI`
//   2. cerebroRiskCategory / cerebroRiskAnalysis populated despite
//      the cerebro-glean adapter explicitly NOT extracting these
//      from Glean's structured cerebro datasource (see
//      packages/adapters/read/cerebro-glean/src/mapper.ts:184)
//
// The cleanup, applied to every refresh_run's snapshot_account rows:
//   - Drops the spreadsheet sourceLink from sourceLinks[]
//   - Sets cerebroRiskCategory = null, cerebroRiskAnalysis = null
//   - Drops `cerebro` from lastFetchedFromSource (the real adapter
//     failed with 401 in every run today — no legitimate value lives
//     in this slot to preserve)
//   - Re-runs scoring + ranking on every account_view row so risk
//     source flips back to `fallback` and bucket distribution
//     reflects only real-source data
//
// Idempotent. Re-runnable. Safe to discard after a few weeks once
// the live adapters have produced enough refreshes that the
// poisoned snapshots have aged out of /wow comparisons.
import { Client } from 'pg';
import type {
  CanonicalAccount,
  CanonicalOpportunity,
} from '../packages/canonical/src/index.js';
import {
  buildAccountView,
  rankAccountViews,
} from '../packages/scoring/src/index.js';

const SPREADSHEET_DOC_ID = '1nhA-AFBQLAbHJpriuRLlpNC4GTQPQ0xISNhw8vFGfyI';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://mdas:mdas@localhost:5432/mdas';

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 1) Find every refresh_run that has at least one poisoned account
  //    so we know how much surface to scrub.
  const { rows: runs } = await client.query(
    `SELECT DISTINCT refresh_id
     FROM snapshot_account
     WHERE payload->>'cerebroRiskAnalysis' IS NOT NULL
        OR payload::text LIKE '%' || $1 || '%'`,
    [SPREADSHEET_DOC_ID],
  );
  console.log(`Affected refresh runs: ${runs.length}`);
  if (runs.length === 0) {
    console.log('Nothing to clean up.');
    await client.end();
    return;
  }

  for (const { refresh_id: refreshId } of runs) {
    console.log(`\nCleaning refresh ${refreshId}`);

    const { rows: accountRows } = await client.query(
      `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
      [refreshId],
    );
    let scrubbed = 0;
    const allAccounts: CanonicalAccount[] = [];
    for (const r of accountRows) {
      const acc = r.payload as CanonicalAccount;
      let modified = false;
      // (a) Drop the gdrive sourceLink.
      const before = acc.sourceLinks?.length ?? 0;
      acc.sourceLinks = (acc.sourceLinks ?? []).filter(
        (l) => !(l.url ?? '').includes(SPREADSHEET_DOC_ID),
      );
      if (acc.sourceLinks.length !== before) modified = true;
      // (b) Null out cerebroRiskCategory / Analysis — the real
      //     cerebro-glean adapter does not populate these.
      if (acc.cerebroRiskCategory !== null) {
        acc.cerebroRiskCategory = null;
        modified = true;
      }
      if (acc.cerebroRiskAnalysis !== null) {
        acc.cerebroRiskAnalysis = null;
        modified = true;
      }
      // (c) Drop cerebro freshness — no real adapter run has populated it.
      if (acc.lastFetchedFromSource && 'cerebro' in acc.lastFetchedFromSource) {
        delete acc.lastFetchedFromSource.cerebro;
        modified = true;
      }
      if (modified) {
        await client.query(
          `UPDATE snapshot_account SET payload = $1::jsonb WHERE refresh_id = $2 AND account_id = $3`,
          [JSON.stringify(acc), refreshId, r.account_id],
        );
        scrubbed += 1;
      }
      allAccounts.push(acc);
    }
    console.log(`  Scrubbed ${scrubbed}/${accountRows.length} snapshot_account rows`);

    // (d) Re-score + re-rank account_view for this refresh.
    const { rows: oppRows } = await client.query(
      `SELECT account_id, payload FROM snapshot_opportunity WHERE refresh_id = $1`,
      [refreshId],
    );
    const oppsByAcc = new Map<string, CanonicalOpportunity[]>();
    for (const r of oppRows) {
      const list = oppsByAcc.get(r.account_id) ?? [];
      list.push(r.payload as CanonicalOpportunity);
      oppsByAcc.set(r.account_id, list);
    }
    const views = allAccounts.map((a) =>
      buildAccountView(a, oppsByAcc.get(a.accountId) ?? []),
    );
    rankAccountViews(views);

    await client.query('BEGIN');
    try {
      for (const v of views) {
        await client.query(
          `UPDATE account_view SET view_payload = $1::jsonb
           WHERE refresh_id = $2 AND account_id = $3`,
          [JSON.stringify(v), refreshId, v.account.accountId],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    console.log(`  Re-scored ${views.length} account_view rows`);
  }

  await client.end();
  console.log('\nDone. UI should now reflect only real-adapter data (mostly grey "no data" pills until tokens land).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

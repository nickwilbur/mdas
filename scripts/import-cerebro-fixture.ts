// One-shot importer: take the Cerebro CSV that Cascade pulled out of
// Glean (via mcp2_read_document on the gdrive sheet at
// gdrive:1nhA-AFBQLAbHJpriuRLlpNC4GTQPQ0xISNhw8vFGfyI), parsed into
// seed/cerebro-snapshot.json, and merge it into the latest successful
// refresh's account snapshot + re-score so the UI sees real Cerebro
// risk categories without the worker needing a service-account
// Glean token.
//
// This is a BRIDGE. The proper path is the cerebro-glean adapter
// running inside the worker on every refresh. Re-run this script
// after any new Glean pull while the token is still being sorted out.
//
// Usage:
//   node scripts/import-cerebro-fixture.mjs
//
// Env: requires DATABASE_URL (defaults to local docker compose URL).
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import type {
  Bucket,
  CanonicalAccount,
  CanonicalOpportunity,
  CerebroRiskCategory,
  SourceLink,
} from '../packages/canonical/src/index.js';
import {
  buildAccountView,
  rankAccountViews,
} from '../packages/scoring/src/index.js';

interface FixtureRow {
  salesforceAccountId: string;
  accountName: string;
  cerebroRiskCategory: CerebroRiskCategory;
  cerebroRiskAnalysis: string | null;
}
interface Fixture {
  source: string;
  fetchedAt?: string;
  accounts: FixtureRow[];
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync('seed/cerebro-snapshot.json', 'utf8'),
);
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://mdas:mdas@localhost:5432/mdas';

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 1) Find the latest successful refresh.
  const { rows: latestRows } = await client.query(
    `SELECT id, started_at FROM refresh_runs WHERE status = 'success'
     ORDER BY started_at DESC LIMIT 1`,
  );
  if (latestRows.length === 0) {
    console.error('No successful refresh found — run `npm run seed` first.');
    process.exit(1);
  }
  const refreshId = latestRows[0].id;
  console.log(
    `Target refresh: ${refreshId} (started ${latestRows[0].started_at.toISOString()})`,
  );

  // 2) Build a SFDC-id-keyed lookup from the fixture.
  //
  // Salesforce IDs come in two formats: 15-char case-sensitive and 18-char
  // case-insensitive (15 + 3-char checksum). The Glean spreadsheet ships
  // 18-char IDs; our snapshot's `salesforceAccountId` field is 15-char.
  // The first 15 chars are identical, so we key the lookup by the 15-char
  // prefix and the same prefix at lookup time.
  const sfidKey = (raw: string): string => raw.trim().slice(0, 15);
  const fixtureBySfid = new Map<string, FixtureRow>(
    FIXTURE.accounts
      .filter((a) => a.salesforceAccountId && a.cerebroRiskCategory)
      .map((a) => [sfidKey(a.salesforceAccountId), a]),
  );
  console.log(
    `Fixture: ${fixtureBySfid.size} accounts with non-null risk category`,
  );

  // 3) Pull every account in the snapshot.
  const { rows: accountRows } = await client.query(
    `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
    [refreshId],
  );
  console.log(`Snapshot: ${accountRows.length} accounts`);

  // 4) For each, if its salesforceAccountId matches the fixture, deep-merge.
  const fetchedAt = FIXTURE.fetchedAt ?? new Date().toISOString();
  let mergedCount = 0;
  const updatedAccounts: CanonicalAccount[] = []; // ones we touched, for re-scoring
  const allAccountsForScoring: CanonicalAccount[] = [];

  for (const r of accountRows) {
    const acc = r.payload as CanonicalAccount;
    const sfid = sfidKey(acc.salesforceAccountId ?? '');
    const fix = fixtureBySfid.get(sfid);
    if (!fix) {
      allAccountsForScoring.push(acc);
      continue;
    }
    // Merge Cerebro fields into the canonical account.
    acc.cerebroRiskCategory = fix.cerebroRiskCategory;
    acc.cerebroRiskAnalysis = fix.cerebroRiskAnalysis ?? acc.cerebroRiskAnalysis;
    acc.lastFetchedFromSource = {
      ...(acc.lastFetchedFromSource ?? {}),
      cerebro: fetchedAt,
    };
    // Add a sourceLink if not already present.
    const existing = (acc.sourceLinks ?? []).some(
      (l: SourceLink) =>
        l.url ===
        FIXTURE.source.replace(
          'gdrive:',
          'https://docs.google.com/spreadsheets/d/',
        ),
    );
    if (!existing) {
      acc.sourceLinks = [
        ...(acc.sourceLinks ?? []),
        {
          source: 'cerebro',
          label: `Cerebro Risk: ${fix.cerebroRiskCategory}`,
          url: `https://docs.google.com/spreadsheets/d/${FIXTURE.source.replace('gdrive:', '')}`,
        },
      ];
    }

    // Persist back to snapshot_account.
    await client.query(
      `UPDATE snapshot_account SET payload = $1::jsonb WHERE refresh_id = $2 AND account_id = $3`,
      [JSON.stringify(acc), refreshId, r.account_id],
    );
    mergedCount += 1;
    updatedAccounts.push(acc);
    allAccountsForScoring.push(acc);
  }

  console.log(
    `Merged Cerebro into ${mergedCount} snapshot_account rows (${accountRows.length - mergedCount} untouched)`,
  );

  // 5) Re-score: rebuild AccountView for every account in the refresh,
  //    re-rank, and write account_view rows. We do this for ALL accounts
  //    (not just merged ones) because rank depends on the global ordering
  //    and the fixture changes risk categories that drive bucket/rank.
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

  const views = allAccountsForScoring.map((a) =>
    buildAccountView(a, oppsByAcc.get(a.accountId) ?? []),
  );
  rankAccountViews(views);

  // 6) Write each view back to account_view.
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
  console.log(`Re-scored + re-ranked ${views.length} account_view rows`);

  // 7) Quick verification — count buckets after the merge.
  const buckets = views.reduce<Record<Bucket, number>>(
    (acc, v) => {
      acc[v.bucket] = (acc[v.bucket] ?? 0) + 1;
      return acc;
    },
    { 'Saveable Risk': 0, 'Confirmed Churn': 0, Healthy: 0 },
  );
  console.log('Bucket distribution after merge:', buckets);
  const cerebroSourcedRisks = views.filter((v) => v.risk.source === 'cerebro').length;
  console.log(
    `Risk identifier source: cerebro=${cerebroSourcedRisks}, fallback=${views.length - cerebroSourcedRisks}`,
  );

  await client.end();
  console.log('\nDone. Reload http://localhost:3000/accounts to see the changes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-shot importer: merge real Salesforce + Glean enrichment data
// (gathered interactively by Cascade via the glean_default MCP, same
// OAuth path as Windsurf) into the latest refresh's snapshot.
//
// Usage:
//   npx tsx scripts/import-cascade-bridge.ts
//
// Fixture: seed/cascade-bridge.json — produced by Cascade by calling
// mcp2_search(app=salescloud) per account and parsing the SFDC field
// dump from the snippet, plus mcp2_search(app=gainsight) for CTAs.
//
// This is a BRIDGE. The proper path remains the salesforce + glean-mcp
// + gainsight adapters running inside the worker on every refresh, once
// the user populates SALESFORCE_* / GLEAN_MCP_TOKEN. When those land,
// the worker runs Salesforce LAST per the precedence policy in
// README.md, and overrides every field this bridge wrote.
//
// Per-source markers ensure the UI shows correct provenance:
//   - SF fields (name, owner, sentiment, ARR, ...) marked as
//     `lastFetchedFromSource.salesforce`
//   - Gainsight CTAs marked as `lastFetchedFromSource.gainsight`
//   - Source links replaced with the live URLs returned by Glean
//     (so "SFDC Account" links to the real /Account/<id>/view, not a
//     hard-coded zuora.lightning.force.com mock)
//
// Idempotent. Re-runnable as the fixture grows.
import { readFileSync, existsSync } from 'node:fs';
import { Client } from 'pg';
import type {
  CanonicalAccount,
  CanonicalOpportunity,
  CSESentiment,
  GainsightTask,
  SourceLink,
} from '../packages/canonical/src/index.js';
import {
  buildAccountView,
  rankAccountViews,
} from '../packages/scoring/src/index.js';

interface BridgeAccount {
  /** 18-char SFDC account ID from Glean salescloud. */
  salesforceAccountId: string;
  /** Pulled from "Account Name" field in SF. */
  accountName?: string;
  /** Real SF account view URL from search result, e.g.
   *  https://zuora.lightning.force.com/lightning/r/Account/<id>/view */
  sfAccountUrl?: string;

  // -- SF-owned fields (override mock localSnapshots data) --
  accountOwner?: { id: string; name: string };
  assignedCSE?: { id: string; name: string };
  csCoverage?: 'CSE' | 'ESA' | 'Digital';
  franchise?: string;
  cseSentiment?: CSESentiment;
  cseSentimentCommentary?: string | null;
  cseSentimentLastUpdated?: string | null;
  cseSentimentCommentaryLastUpdated?: string | null;
  allTimeARR?: number;
  activeProductLines?: string[];
  zuoraTenantId?: string | null;
  isConfirmedChurn?: boolean;

  // -- Gainsight enrichment --
  gainsightTasks?: GainsightTask[];
  gainsightCompanyUrl?: string;
}
interface Bridge {
  fetchedAt: string;
  source: 'cascade-glean-mcp';
  accounts: BridgeAccount[];
}

const FIXTURE_PATH = 'seed/cascade-bridge.json';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://mdas:mdas@localhost:5432/mdas';

if (!existsSync(FIXTURE_PATH)) {
  console.error(`No fixture at ${FIXTURE_PATH}. Cascade must populate it first.`);
  process.exit(1);
}
const FIXTURE: Bridge = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// Salesforce IDs come in two formats: 15-char case-sensitive and 18-char
// case-insensitive (15 + 3-char checksum). The first 15 chars are
// identical across both. The snapshot stores 15-char in
// `salesforceAccountId` but 18-char in `accountId`. Glean salescloud
// returns 18-char. Match by 15-char prefix to be safe.
const sfidKey = (raw: string): string => raw.trim().slice(0, 15);

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 1) Latest successful refresh.
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

  // 2) Fixture lookup keyed by 15-char SFDC ID.
  const fixtureBySfid = new Map<string, BridgeAccount>(
    FIXTURE.accounts.map((a) => [sfidKey(a.salesforceAccountId), a]),
  );
  console.log(`Fixture: ${fixtureBySfid.size} bridged accounts`);

  // 3) Pull every account in the snapshot.
  const { rows: accountRows } = await client.query(
    `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
    [refreshId],
  );
  console.log(`Snapshot: ${accountRows.length} accounts`);

  // 4) Merge per-account.
  const fetchedAt = FIXTURE.fetchedAt;
  let sfMerged = 0;
  let gsMerged = 0;
  const allAccountsForScoring: CanonicalAccount[] = [];

  for (const r of accountRows) {
    const acc = r.payload as CanonicalAccount;
    const sfid = sfidKey(acc.salesforceAccountId ?? acc.accountId ?? '');
    const fix = fixtureBySfid.get(sfid);
    if (!fix) {
      allAccountsForScoring.push(acc);
      continue;
    }

    // Strip prior bridge sourceLinks (idempotency).
    acc.sourceLinks = (acc.sourceLinks ?? []).filter(
      (l) =>
        !(l.label === 'SFDC Account (via Glean)') &&
        !(l.label === 'Gainsight Company (via Glean)'),
    );

    let sfTouched = false;
    let gsTouched = false;
    let mergedSourceLinks: SourceLink[] = acc.sourceLinks ?? [];

    // ---- SF override (precedence: this overrides mock localSnapshots) ----
    if (fix.accountName) {
      acc.accountName = fix.accountName;
      sfTouched = true;
    }
    if (fix.accountOwner) {
      acc.accountOwner = fix.accountOwner;
      sfTouched = true;
    }
    if (fix.assignedCSE) {
      acc.assignedCSE = fix.assignedCSE;
      sfTouched = true;
    }
    if (fix.csCoverage) {
      acc.csCoverage = fix.csCoverage;
      sfTouched = true;
    }
    if (fix.franchise) {
      acc.franchise = fix.franchise;
      sfTouched = true;
    }
    if (fix.cseSentiment !== undefined) {
      acc.cseSentiment = fix.cseSentiment;
      sfTouched = true;
    }
    if (fix.cseSentimentCommentary !== undefined) {
      acc.cseSentimentCommentary = fix.cseSentimentCommentary;
      sfTouched = true;
    }
    if (fix.cseSentimentLastUpdated !== undefined) {
      acc.cseSentimentLastUpdated = fix.cseSentimentLastUpdated;
      sfTouched = true;
    }
    if (fix.cseSentimentCommentaryLastUpdated !== undefined) {
      acc.cseSentimentCommentaryLastUpdated = fix.cseSentimentCommentaryLastUpdated;
      sfTouched = true;
    }
    if (fix.allTimeARR !== undefined) {
      acc.allTimeARR = fix.allTimeARR;
      sfTouched = true;
    }
    if (fix.activeProductLines) {
      acc.activeProductLines = fix.activeProductLines;
      sfTouched = true;
    }
    if (fix.zuoraTenantId !== undefined) {
      acc.zuoraTenantId = fix.zuoraTenantId;
      sfTouched = true;
    }
    if (fix.isConfirmedChurn !== undefined) {
      acc.isConfirmedChurn = fix.isConfirmedChurn;
      sfTouched = true;
    }
    // Replace SFDC source link with the real one from Glean.
    if (fix.sfAccountUrl) {
      mergedSourceLinks = mergedSourceLinks.filter(
        (l) => l.source !== 'salesforce',
      );
      mergedSourceLinks.push({
        source: 'salesforce',
        label: 'SFDC Account (via Glean)',
        url: fix.sfAccountUrl,
      });
      sfTouched = true;
    }

    // ---- Gainsight enrichment ----
    if (fix.gainsightTasks && fix.gainsightTasks.length > 0) {
      acc.gainsightTasks = fix.gainsightTasks;
      gsTouched = true;
    }
    if (fix.gainsightCompanyUrl) {
      mergedSourceLinks = mergedSourceLinks.filter(
        (l) => l.source !== 'gainsight',
      );
      mergedSourceLinks.push({
        source: 'gainsight',
        label: 'Gainsight Company (via Glean)',
        url: fix.gainsightCompanyUrl,
      });
      gsTouched = true;
    }

    acc.sourceLinks = mergedSourceLinks;

    // ---- Provenance markers ----
    acc.lastFetchedFromSource = { ...(acc.lastFetchedFromSource ?? {}) };
    if (sfTouched) acc.lastFetchedFromSource.salesforce = fetchedAt;
    if (gsTouched) acc.lastFetchedFromSource.gainsight = fetchedAt;

    if (sfTouched || gsTouched) {
      acc.lastUpdated = fetchedAt;
      await client.query(
        `UPDATE snapshot_account SET payload = $1::jsonb WHERE refresh_id = $2 AND account_id = $3`,
        [JSON.stringify(acc), refreshId, r.account_id],
      );
      if (sfTouched) sfMerged += 1;
      if (gsTouched) gsMerged += 1;
    }
    allAccountsForScoring.push(acc);
  }

  console.log(
    `Merged: SF=${sfMerged} Gainsight=${gsMerged} (of ${accountRows.length} snapshot accounts)`,
  );

  // 5) Re-score account_view for the refresh.
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
  console.log(`Re-scored ${views.length} account_view rows`);

  // 6) Verification stats.
  const buckets = views.reduce<Record<string, number>>(
    (a, v) => ((a[v.bucket] = (a[v.bucket] ?? 0) + 1), a),
    {},
  );
  console.log('Bucket distribution:', buckets);
  const sentimentCounts = views.reduce<Record<string, number>>(
    (a, v) => {
      const s = v.account.cseSentiment ?? 'null';
      a[s] = (a[s] ?? 0) + 1;
      return a;
    },
    {},
  );
  console.log('CSE Sentiment distribution:', sentimentCounts);

  await client.end();
  console.log('\nDone. Reload http://localhost:3000/accounts.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

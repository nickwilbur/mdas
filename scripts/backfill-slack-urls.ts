// One-off backfill: pull Internal_Customer_Slack_Channel__c from
// Salesforce for every account in the latest snapshot and patch
// snapshot_account.payload.salesforceSlackChannelUrl in place.
//
// Why this exists: a normal refresh (apps/worker) re-fetches every
// adapter end-to-end (~25 min with Glean). When all we need is one
// new SFDC column threaded into the existing snapshot, this script
// is the safe, narrow path. After it finishes, /api/slack/mappings/refresh
// will pick up the URLs and produce real 'mapped' statuses.
//
// Idempotent: re-running with the same SFDC state produces the same
// payloads (no churn). Only touches the `salesforceSlackChannelUrl`
// field on each account payload; all other fields are preserved
// byte-for-byte.

import { query, latestSuccessfulRun } from '@mdas/db';
import { SalesforceClient, readSalesforceCredsFromEnv } from '../packages/adapters/read/salesforce/src/client.js';
import type { CanonicalAccount } from '@mdas/canonical';

interface Row {
  Id: string;
  Internal_Customer_Slack_Channel__c: string | null;
}

async function main() {
const creds = readSalesforceCredsFromEnv();
if (!creds) {
  console.error('SALESFORCE_* env vars not set — cannot backfill.');
  process.exit(1);
}

const run = await latestSuccessfulRun();
if (!run) {
  console.error('No successful refresh run yet.');
  process.exit(1);
}
console.log(`[backfill] Latest run: ${run.id} (started ${run.started_at})`);

const client = new SalesforceClient(creds);
const rows = await client.query<Row>(
  `SELECT Id, Internal_Customer_Slack_Channel__c
   FROM Account
   WHERE Current_FY_Franchise__c = 'Expand 3'
     AND Customer_Status__c IN ('Live', 'Implementing', 'In Production', 'Churned (Live)')`,
);
console.log(`[backfill] Pulled ${rows.length} SFDC accounts`);

const urlById = new Map<string, string | null>();
let withUrl = 0;
for (const r of rows) {
  const v = (r.Internal_Customer_Slack_Channel__c ?? '').trim() || null;
  urlById.set(r.Id, v);
  if (v) withUrl++;
}
console.log(`[backfill] ${withUrl} accounts have a non-empty Slack channel URL in SFDC`);

const snap = await query<{ account_id: string; payload: CanonicalAccount }>(
  `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
  [run.id],
);
console.log(`[backfill] Latest snapshot has ${snap.rows.length} accounts to patch`);

let touched = 0;
let matched = 0;
for (const row of snap.rows) {
  // accountId in canonical = SFDC Id (see mapAccount)
  const sfdcUrl = urlById.get(row.account_id);
  if (sfdcUrl === undefined) continue; // SFDC didn't return this account
  matched++;
  const current = row.payload.salesforceSlackChannelUrl ?? null;
  if (current === sfdcUrl) continue; // already correct
  const patched: CanonicalAccount = { ...row.payload, salesforceSlackChannelUrl: sfdcUrl };
  await query(
    `UPDATE snapshot_account SET payload = $1::jsonb WHERE refresh_id = $2 AND account_id = $3`,
    [JSON.stringify(patched), run.id, row.account_id],
  );
  touched++;
}
console.log(
  `[backfill] Matched ${matched}/${snap.rows.length} snapshot accounts to SFDC; ` +
    `patched ${touched} payloads.`,
);
process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

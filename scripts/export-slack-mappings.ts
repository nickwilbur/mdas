// Export current customer_slack_mapping rows to a validation CSV.
//
// Intended for sharing with the team that owns the operational tracker
// so they can spot-check account → channel links before we rely on
// them for sends (phase 1b).
//
// Usage (from repo root, with .env loaded so DATABASE_URL resolves):
//   set -a && source .env && set +a && npx tsx scripts/export-slack-mappings.ts
//
// Optional:
//   --out data/my-export.csv
//   --status mapped          (filter to one status)
//
// Output defaults to data/slack-mappings-validation.csv

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, latestSuccessfulRun } from '@mdas/db';
import type { CanonicalAccount } from '@mdas/canonical';

const __filename = fileURLToPath(import.meta.url);
const __ROOT = dirname(__filename);
const REPO_ROOT = resolve(__ROOT, '..');

const COLUMNS = [
  'account_id',
  'account_name',
  'franchise',
  'assigned_cse',
  'account_owner',
  'sfdc_slack_field_filled',
  'salesforce_slack_channel_url',
  'slack_url',
  'slack_channel_id',
  'channel_name',
  'derived_channel_name',
  'status',
  'source',
  'is_archived',
  'status_reason',
  'last_refreshed_at',
  'validation_ok',
  'validation_notes',
] as const;

function csvEscape(v: unknown): string {
  if (v == null) return '""';
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function parseArgs(): { outPath: string; status?: string } {
  const args = process.argv.slice(2);
  let outPath = resolve(REPO_ROOT, 'data/slack-mappings-validation.csv');
  let status: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outPath = resolve(REPO_ROOT, args[++i]!);
    } else if (args[i] === '--status' && args[i + 1]) {
      status = args[++i]!.trim();
    }
  }
  return { outPath, status };
}

interface MappingRow {
  account_id: string;
  account_name: string | null;
  slack_url: string | null;
  slack_channel_id: string | null;
  channel_name: string | null;
  derived_channel_name: string | null;
  status: string;
  source: string;
  is_archived: boolean | null;
  status_reason: string | null;
  last_refreshed_at: string;
}

async function main(): Promise<void> {
  const { outPath, status } = parseArgs();

  const where = status ? 'WHERE m.status = $1' : '';
  const params = status ? [status] : [];

  const mappings = await query<MappingRow>(
    `SELECT
       m.account_id,
       m.account_name,
       m.slack_url,
       m.slack_channel_id,
       m.channel_name,
       m.derived_channel_name,
       m.status,
       m.source,
       m.is_archived,
       m.status_reason,
       m.last_refreshed_at
     FROM customer_slack_mapping m
     ${where}
     ORDER BY m.account_name NULLS LAST, m.account_id`,
    params,
  );

  const run = await latestSuccessfulRun();
  const snapshotById = new Map<string, CanonicalAccount>();
  if (run) {
    const snap = await query<{ payload: CanonicalAccount }>(
      `SELECT payload FROM snapshot_account WHERE refresh_id = $1`,
      [run.id],
    );
    for (const row of snap.rows) {
      snapshotById.set(row.payload.accountId, row.payload);
    }
  }

  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => csvEscape(c)).join(','));

  for (const m of mappings.rows) {
    const snap = snapshotById.get(m.account_id);
    const sfdcUrl = snap?.salesforceSlackChannelUrl ?? null;
    lines.push(
      [
        m.account_id,
        m.account_name ?? '',
        snap?.franchise ?? '',
        snap?.assignedCSE?.name ?? '',
        snap?.accountOwner?.name ?? '',
        sfdcUrl ? 'yes' : 'no',
        sfdcUrl ?? '',
        m.slack_url ?? '',
        m.slack_channel_id ?? '',
        m.channel_name ?? '',
        m.derived_channel_name ?? '',
        m.status,
        m.source,
        m.is_archived == null ? '' : m.is_archived ? 'true' : 'false',
        m.status_reason ?? '',
        m.last_refreshed_at,
        '',
        '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\r\n') + '\r\n', 'utf8');

  console.log(
    `[export] Wrote ${mappings.rows.length} rows to ${outPath}` +
      (status ? ` (status=${status})` : ''),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

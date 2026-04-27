import pg from 'pg';
import type {
  AccountView,
  CanonicalAccount,
  CanonicalOpportunity,
} from '@mdas/canonical';

const { Pool } = pg;

let _pool: pg.Pool | null = null;
export function pool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString:
        process.env.DATABASE_URL || 'postgres://mdas:mdas@localhost:5432/mdas',
      max: 10,
    });
  }
  return _pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool().query<T>(sql, params as never[]);
}

// ---------- Refresh runs ----------

export interface RefreshRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  scoring_version: string;
  sources_attempted: string[];
  sources_succeeded: string[];
  row_counts: Record<string, number> | null;
  error_log: unknown;
}

export async function startRefreshRun(opts: {
  scoringVersion: string;
  sources: string[];
}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO refresh_runs (started_at, status, scoring_version, sources_attempted, sources_succeeded)
     VALUES (NOW(), 'running', $1, $2::jsonb, '[]'::jsonb) RETURNING id`,
    [opts.scoringVersion, JSON.stringify(opts.sources)],
  );
  return r.rows[0]!.id;
}

export async function completeRefreshRun(
  id: string,
  status: 'success' | 'partial' | 'failed',
  data: {
    sourcesSucceeded: string[];
    rowCounts: Record<string, number>;
    errorLog?: unknown;
  },
): Promise<void> {
  await query(
    `UPDATE refresh_runs
       SET completed_at = NOW(),
           status = $2,
           sources_succeeded = $3::jsonb,
           row_counts = $4::jsonb,
           error_log = $5::jsonb
     WHERE id = $1`,
    [
      id,
      status,
      JSON.stringify(data.sourcesSucceeded),
      JSON.stringify(data.rowCounts),
      JSON.stringify(data.errorLog ?? null),
    ],
  );
}

export async function listRefreshRuns(limit = 20): Promise<RefreshRun[]> {
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

export async function latestSuccessfulRun(): Promise<RefreshRun | null> {
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs WHERE status IN ('success','partial') ORDER BY started_at DESC LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

export async function previousSuccessfulRun(
  beforeId: string,
): Promise<RefreshRun | null> {
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs
       WHERE status IN ('success','partial')
         AND started_at < (SELECT started_at FROM refresh_runs WHERE id = $1)
     ORDER BY started_at DESC LIMIT 1`,
    [beforeId],
  );
  return r.rows[0] ?? null;
}

export async function pruneOldRuns(retain = 12): Promise<number> {
  const r = await query<{ id: string }>(
    `DELETE FROM refresh_runs
       WHERE id IN (
         SELECT id FROM refresh_runs ORDER BY started_at DESC OFFSET $1
       ) RETURNING id`,
    [retain],
  );
  return r.rowCount ?? 0;
}

// ---------- Snapshots ----------

export async function writeSnapshotAccounts(
  refreshId: string,
  accounts: CanonicalAccount[],
): Promise<void> {
  if (accounts.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  accounts.forEach((a, i) => {
    const o = i * 4;
    values.push(`($${o + 1}, $${o + 2}, $${o + 3}::jsonb, $${o + 4})`);
    params.push(refreshId, a.accountId, JSON.stringify(a), a.lastUpdated);
  });
  await query(
    `INSERT INTO snapshot_account (refresh_id, account_id, payload, captured_at)
     VALUES ${values.join(',')}
     ON CONFLICT (refresh_id, account_id) DO UPDATE SET payload = EXCLUDED.payload`,
    params,
  );
}

export async function writeSnapshotOpportunities(
  refreshId: string,
  opps: CanonicalOpportunity[],
): Promise<void> {
  if (opps.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  opps.forEach((o, i) => {
    const off = i * 5;
    values.push(
      `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}::jsonb, $${off + 5})`,
    );
    params.push(refreshId, o.opportunityId, o.accountId, JSON.stringify(o), o.lastUpdated);
  });
  await query(
    `INSERT INTO snapshot_opportunity (refresh_id, opportunity_id, account_id, payload, captured_at)
     VALUES ${values.join(',')}
     ON CONFLICT (refresh_id, opportunity_id) DO UPDATE SET payload = EXCLUDED.payload`,
    params,
  );
}

export async function readSnapshotAccounts(
  refreshId: string,
): Promise<CanonicalAccount[]> {
  const r = await query<{ payload: CanonicalAccount }>(
    `SELECT payload FROM snapshot_account WHERE refresh_id = $1`,
    [refreshId],
  );
  return r.rows.map((x) => x.payload);
}

export async function readSnapshotOpportunities(
  refreshId: string,
): Promise<CanonicalOpportunity[]> {
  const r = await query<{ payload: CanonicalOpportunity }>(
    `SELECT payload FROM snapshot_opportunity WHERE refresh_id = $1`,
    [refreshId],
  );
  return r.rows.map((x) => x.payload);
}

// ---------- Account views ----------

export async function writeAccountViews(
  refreshId: string,
  views: AccountView[],
): Promise<void> {
  if (views.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  views.forEach((v, i) => {
    const o = i * 3;
    values.push(`($${o + 1}, $${o + 2}, $${o + 3}::jsonb)`);
    params.push(refreshId, v.account.accountId, JSON.stringify(v));
  });
  await query(
    `INSERT INTO account_view (refresh_id, account_id, view_payload)
     VALUES ${values.join(',')}
     ON CONFLICT (refresh_id, account_id) DO UPDATE SET view_payload = EXCLUDED.view_payload`,
    params,
  );
}

export async function readAccountViews(
  refreshId: string,
): Promise<AccountView[]> {
  const r = await query<{ view_payload: AccountView }>(
    `SELECT view_payload FROM account_view WHERE refresh_id = $1`,
    [refreshId],
  );
  return r.rows.map((x) => x.view_payload);
}

export async function readAccountView(
  refreshId: string,
  accountId: string,
): Promise<AccountView | null> {
  const r = await query<{ view_payload: AccountView }>(
    `SELECT view_payload FROM account_view WHERE refresh_id = $1 AND account_id = $2`,
    [refreshId, accountId],
  );
  return r.rows[0]?.view_payload ?? null;
}

// ---------- Audit log ----------

export async function audit(
  actor: string,
  event: string,
  details: unknown = null,
): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor, event, details) VALUES ($1, $2, $3::jsonb)`,
    [actor, event, JSON.stringify(details)],
  );
}

export async function readAuditLog(limit = 100): Promise<
  { id: number; occurred_at: string; actor: string; event: string; details: unknown }[]
> {
  const r = await query<{
    id: number;
    occurred_at: string;
    actor: string;
    event: string;
    details: unknown;
  }>(
    `SELECT id, occurred_at, actor, event, details FROM audit_log ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

// ---------- Refresh jobs ----------

export async function enqueueRefreshJob(requestedBy = 'manual:nick'): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO refresh_jobs (requested_by) VALUES ($1) RETURNING id`,
    [requestedBy],
  );
  await query(`SELECT pg_notify('refresh', $1)`, [r.rows[0]!.id]);
  return r.rows[0]!.id;
}

export async function claimNextJob(): Promise<{ id: string } | null> {
  const r = await query<{ id: string }>(
    `UPDATE refresh_jobs SET status = 'running', started_at = NOW()
       WHERE id = (SELECT id FROM refresh_jobs WHERE status = 'queued' ORDER BY enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
  );
  return r.rows[0] ?? null;
}

export async function completeJob(
  id: string,
  refreshRunId: string,
  status: 'success' | 'failed',
): Promise<void> {
  await query(
    `UPDATE refresh_jobs SET status = $2, completed_at = NOW(), refresh_run_id = $3 WHERE id = $1`,
    [id, status, refreshRunId],
  );
}

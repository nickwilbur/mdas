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
  progress?: RefreshProgress;
  /** Memoized Health Snapshot KPIs — see migration 0005. */
  trajectory_kpis?: unknown;
}

// ---------- Refresh progress ----------

export interface AdapterProgress {
  status: 'pending' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  /** Human-readable label, e.g. "Enriching Acme Corp" */
  label?: string;
}

export interface RefreshProgress {
  adapters?: Record<string, AdapterProgress>;
  /** Overall percentage 0-100, computed by the orchestrator. */
  pct?: number;
}

export async function updateRefreshProgress(
  refreshId: string,
  progress: RefreshProgress,
): Promise<void> {
  await query(
    `UPDATE refresh_runs SET progress = $2::jsonb WHERE id = $1`,
    [refreshId, JSON.stringify(progress)],
  );
}

export async function getRefreshProgress(
  refreshId: string,
): Promise<RefreshProgress> {
  const r = await query<{ progress: RefreshProgress }>(
    `SELECT progress FROM refresh_runs WHERE id = $1`,
    [refreshId],
  );
  return r.rows[0]?.progress ?? {};
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

/**
 * List successful (or partial) refresh runs whose `started_at` is at
 * or after the given ISO timestamp, oldest first. Used by the Health
 * Snapshot trajectory loader to walk every snapshot taken since the
 * start of the current fiscal quarter so it can build a per-day KPI
 * series for the Glean Adaptive narrative call.
 *
 * Returned oldest-first so callers can iterate naturally; that's the
 * opposite of `listRefreshRuns` but matches the trajectory use case
 * (a time series read start → today, not "what's the latest").
 */
export async function listSuccessfulRunsSince(
  sinceIso: string,
): Promise<RefreshRun[]> {
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs
       WHERE status IN ('success','partial')
         AND started_at >= $1::timestamptz
     ORDER BY started_at ASC`,
    [sinceIso],
  );
  return r.rows;
}

export async function listAllSuccessfulRefreshRuns(): Promise<RefreshRun[]> {
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs
       WHERE status IN ('success','partial')
     ORDER BY started_at ASC`,
  );
  return r.rows;
}

export async function updateRefreshTrajectoryKpis(
  refreshId: string,
  kpis: unknown,
): Promise<void> {
  await query(
    `UPDATE refresh_runs SET trajectory_kpis = $2::jsonb WHERE id = $1`,
    [refreshId, JSON.stringify(kpis)],
  );
}

export interface SourceLinkBloatRow {
  refresh_id: string;
  started_at: string;
  max_account_links: number;
  max_opp_links: number;
}

/** Audit helper for compact-snapshot-source-links.ts */
export async function auditSourceLinkBloat(limit = 20): Promise<SourceLinkBloatRow[]> {
  const r = await query<SourceLinkBloatRow>(
    `
    WITH acct AS (
      SELECT refresh_id,
             COALESCE(MAX(jsonb_array_length(payload->'sourceLinks')), 0)::int AS max_account_links
      FROM snapshot_account
      GROUP BY refresh_id
    ),
    opp AS (
      SELECT refresh_id,
             COALESCE(MAX(jsonb_array_length(payload->'sourceLinks')), 0)::int AS max_opp_links
      FROM snapshot_opportunity
      GROUP BY refresh_id
    )
    SELECT r.id AS refresh_id,
           r.started_at,
           COALESCE(a.max_account_links, 0) AS max_account_links,
           COALESCE(o.max_opp_links, 0) AS max_opp_links
    FROM refresh_runs r
    LEFT JOIN acct a ON a.refresh_id = r.id
    LEFT JOIN opp o ON o.refresh_id = r.id
    WHERE r.status IN ('success','partial')
    ORDER BY GREATEST(COALESCE(a.max_account_links, 0), COALESCE(o.max_opp_links, 0)) DESC
    LIMIT $1
    `,
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

/**
 * Find the latest successful run whose started_at is at least `windowDays`
 * before the reference run. This gives meaningful WoW/multi-day diffs even
 * when the user refreshes multiple times a day.
 *
 * Falls back to the earliest available successful run if nothing is old
 * enough — so the UI always shows some diff rather than zero events.
 * Returns null only if no other successful run exists at all.
 */
export async function baselineRunForWindow(
  referenceRunId: string,
  windowDays: number,
): Promise<RefreshRun | null> {
  // Primary: latest run at least windowDays before the reference run.
  const r = await query<RefreshRun>(
    `SELECT * FROM refresh_runs
       WHERE status IN ('success','partial')
         AND id != $1
         AND started_at <= (SELECT started_at FROM refresh_runs WHERE id = $1)
                           - make_interval(days => $2)
     ORDER BY started_at DESC LIMIT 1`,
    [referenceRunId, windowDays],
  );
  if (r.rows[0]) return r.rows[0];

  // Fallback: earliest successful run that isn't the reference run itself.
  // This covers the cold-start case where the only data we have is < windowDays old.
  const fb = await query<RefreshRun>(
    `SELECT * FROM refresh_runs
       WHERE status IN ('success','partial')
         AND id != $1
     ORDER BY started_at ASC LIMIT 1`,
    [referenceRunId],
  );
  return fb.rows[0] ?? null;
}

export async function pruneOldRuns(retain = 12): Promise<number> {
  // Pre-clear the FK from refresh_jobs to the runs we're about to delete.
  // refresh_jobs.refresh_run_id has no ON DELETE action, so a direct DELETE
  // on refresh_runs would fail with FK-violation 23503. We preserve the
  // refresh_jobs row (queue audit history) but drop the now-stale link.
  //
  // PR-C1 — F-16: order by (started_at DESC, id DESC) so the tiebreak is
  // deterministic if two refreshes happen to start in the same millisecond
  // (re-entrant pg_notify drains can do that on a busy worker). Without
  // the secondary key, Postgres' returned order is undefined and
  // OFFSET-12 could land on the most-recent run, deleting it.
  // `id` is a uuid so DESC sorts lexicographically; combined with the
  // primary `started_at DESC` it's stable enough for the prune semantics.
  await query(
    `UPDATE refresh_jobs
        SET refresh_run_id = NULL
      WHERE refresh_run_id IN (
        SELECT id FROM refresh_runs ORDER BY started_at DESC, id DESC OFFSET $1
      )`,
    [retain],
  );
  const r = await query<{ id: string }>(
    `DELETE FROM refresh_runs
       WHERE id IN (
         SELECT id FROM refresh_runs ORDER BY started_at DESC, id DESC OFFSET $1
       ) RETURNING id`,
    [retain],
  );
  return r.rowCount ?? 0;
}

// ---------- Snapshots ----------

/** Chunk size for multi-row INSERT statements (avoids param/query size spikes). */
const SNAPSHOT_WRITE_CHUNK = Number(process.env.SNAPSHOT_WRITE_CHUNK) || 100;

async function insertInChunks<T>(
  items: T[],
  chunkSize: number,
  writeChunk: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await writeChunk(items.slice(i, i + chunkSize));
  }
}

export async function writeSnapshotAccounts(
  refreshId: string,
  accounts: CanonicalAccount[],
): Promise<void> {
  if (accounts.length === 0) return;
  await insertInChunks(accounts, SNAPSHOT_WRITE_CHUNK, async (chunk) => {
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((a, i) => {
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
  });
}

/** Replace the full account snapshot for a refresh (drops rows not in `accounts`). */
export async function replaceSnapshotAccounts(
  refreshId: string,
  accounts: CanonicalAccount[],
): Promise<void> {
  await query(`DELETE FROM snapshot_account WHERE refresh_id = $1`, [refreshId]);
  await writeSnapshotAccounts(refreshId, accounts);
}

export async function writeSnapshotOpportunities(
  refreshId: string,
  opps: CanonicalOpportunity[],
): Promise<void> {
  if (opps.length === 0) return;
  await insertInChunks(opps, SNAPSHOT_WRITE_CHUNK, async (chunk) => {
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((o, i) => {
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
  });
}

/** Replace the full opportunity snapshot for a refresh (drops rows not in `opps`). */
export async function replaceSnapshotOpportunities(
  refreshId: string,
  opps: CanonicalOpportunity[],
): Promise<void> {
  await query(`DELETE FROM snapshot_opportunity WHERE refresh_id = $1`, [refreshId]);
  await writeSnapshotOpportunities(refreshId, opps);
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
  await insertInChunks(views, SNAPSHOT_WRITE_CHUNK, async (chunk) => {
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((v, i) => {
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
  });
}

/** Replace all account views for a refresh (drops rows not in `views`). */
export async function replaceAccountViews(
  refreshId: string,
  views: AccountView[],
): Promise<void> {
  await query(`DELETE FROM account_view WHERE refresh_id = $1`, [refreshId]);
  await writeAccountViews(refreshId, views);
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

/**
 * Mark abandoned jobs as failed.
 *
 * A job ends up in `status='running'` with no progress when its worker
 * crashes (SIGKILL, OOM, container restart) between `claimNextJob()` and
 * the `completeJob()` in the orchestrator's finally-block. Nothing else
 * cleans these up: the next worker boot won't re-claim them (`claimNextJob`
 * only looks at `queued`), and the `/api/refresh` POST coalesce silently
 * latches onto them — every subsequent click on Refresh joins the zombie
 * and the UI sits at 0% until its 40-minute deadline.
 *
 * This helper exists to be called from worker startup (before `drain()`)
 * and, optionally, from a periodic sweep. We only touch rows whose
 * `started_at` is older than `maxAgeMs` — far longer than any real refresh
 * (historical max in this codebase is 837s; default cutoff is 1h) — so we
 * cannot race a live run.
 *
 * Returns the number of rows updated; the caller is expected to log it.
 */
export async function reapStaleJobs(maxAgeMs: number): Promise<number> {
  const r = await query<{ id: string }>(
    `UPDATE refresh_jobs
        SET status = 'failed',
            completed_at = NOW()
      WHERE status = 'running'
        AND started_at IS NOT NULL
        AND started_at < NOW() - ($1::bigint || ' milliseconds')::interval
      RETURNING id`,
    [maxAgeMs],
  );
  return r.rowCount ?? 0;
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

/**
 * Attach the refresh_run id to its job row at the start of the run
 * (rather than waiting for completion). The status API joins
 * refresh_jobs → refresh_runs on this id to surface live progress; if
 * the link isn't set until completeJob() fires at the end, the UI sees
 * `progress: null` for the entire ~15-25min refresh and only lights up
 * for the final frame.
 *
 * No-op when jobId is undefined (refresh-once / unit tests that call
 * runRefresh without going through the job queue).
 */
export async function attachRefreshRunToJob(
  jobId: string,
  refreshRunId: string,
): Promise<void> {
  await query(
    `UPDATE refresh_jobs SET refresh_run_id = $2 WHERE id = $1`,
    [jobId, refreshRunId],
  );
}

// ---------- Account plans ----------

export interface DbAccountPlanRow {
  id: string;
  account_id: string;
  account_name: string | null;
  franchise: string;
  status: string;
  schema_version: string;
  generated_at: string;
  generated_by: string | null;
  generation_mode: string;
  source_snapshot: unknown;
  plan: unknown;
  error_metadata: unknown | null;
  created_at: string;
  updated_at: string;
}

export async function insertAccountPlan(row: {
  accountId: string;
  accountName?: string;
  franchise?: string;
  status: string;
  schemaVersion: string;
  generatedAt: string;
  generatedBy?: string;
  generationMode: string;
  sourceSnapshot: unknown;
  plan: unknown;
  errorMetadata?: unknown;
}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO account_plans (
       account_id, account_name, franchise, status, schema_version,
       generated_at, generated_by, generation_mode, source_snapshot, plan, error_metadata
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
     RETURNING id`,
    [
      row.accountId,
      row.accountName ?? null,
      row.franchise ?? 'Expand 3',
      row.status,
      row.schemaVersion,
      row.generatedAt,
      row.generatedBy ?? null,
      row.generationMode,
      JSON.stringify(row.sourceSnapshot),
      JSON.stringify(row.plan),
      JSON.stringify(row.errorMetadata ?? null),
    ],
  );
  return r.rows[0]!.id;
}

export async function getLatestAccountPlan(accountId: string): Promise<DbAccountPlanRow | null> {
  const r = await query<DbAccountPlanRow>(
    `SELECT * FROM account_plans
       WHERE account_id = $1 AND status != 'refreshing'
     ORDER BY generated_at DESC
     LIMIT 1`,
    [accountId],
  );
  return r.rows[0] ?? null;
}

export async function listAccountPlanHistory(
  accountId: string,
  limit = 20,
): Promise<DbAccountPlanRow[]> {
  const r = await query<DbAccountPlanRow>(
    `SELECT * FROM account_plans
       WHERE account_id = $1 AND status != 'refreshing'
     ORDER BY generated_at DESC
     LIMIT $2`,
    [accountId, limit],
  );
  return r.rows;
}

export async function hasActiveAccountPlanRefresh(accountId: string): Promise<boolean> {
  const r = await query<{ id: string }>(
    `SELECT id FROM account_plans
       WHERE account_id = $1 AND status = 'refreshing'
         AND updated_at > NOW() - INTERVAL '30 minutes'
     LIMIT 1`,
    [accountId],
  );
  return Boolean(r.rows[0]);
}

export async function setAccountPlanRefreshingLock(
  accountId: string,
  accountName: string | undefined,
  generatedBy: string | undefined,
): Promise<string> {
  return insertAccountPlan({
    accountId,
    accountName,
    status: 'refreshing',
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    generatedBy,
    generationMode: 'manual_refresh',
    sourceSnapshot: { collectedAt: new Date().toISOString(), collectors: [], signalIds: [] },
    plan: { accountId, status: 'refreshing' },
  });
}

export async function deleteAccountPlanById(id: string): Promise<void> {
  await query(`DELETE FROM account_plans WHERE id = $1`, [id]);
}

export async function clearStaleRefreshingPlans(maxAgeMinutes = 30): Promise<number> {
  const r = await query<{ id: string }>(
    `DELETE FROM account_plans
       WHERE status = 'refreshing'
         AND updated_at < NOW() - ($1::int || ' minutes')::interval
     RETURNING id`,
    [maxAgeMinutes],
  );
  return r.rowCount ?? 0;
}

export interface AccountPlanBulkJobRow {
  id: string;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  requested_by: string;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export async function enqueueAccountPlanBulkJob(
  accountIds: string[],
  requestedBy = 'manual:nick',
): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO account_plan_bulk_jobs (requested_by, progress)
     VALUES ($1, $2::jsonb)
     RETURNING id`,
    [requestedBy, JSON.stringify({ total: accountIds.length, completed: 0, failed: 0, skipped: 0 })],
  );
  const jobId = r.rows[0]!.id;
  if (accountIds.length > 0) {
    const values: string[] = [];
    const params: unknown[] = [jobId];
    accountIds.forEach((accountId, i) => {
      values.push(`($1, $${i + 2})`);
      params.push(accountId);
    });
    await query(
      `INSERT INTO account_plan_bulk_job_items (job_id, account_id) VALUES ${values.join(',')}`,
      params,
    );
  }
  return jobId;
}

export async function getAccountPlanBulkJob(jobId: string): Promise<AccountPlanBulkJobRow | null> {
  const r = await query<AccountPlanBulkJobRow>(
    `SELECT * FROM account_plan_bulk_jobs WHERE id = $1`,
    [jobId],
  );
  return r.rows[0] ?? null;
}

export async function updateAccountPlanBulkJobProgress(
  jobId: string,
  progress: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE account_plan_bulk_jobs SET progress = $2::jsonb WHERE id = $1`,
    [jobId, JSON.stringify(progress)],
  );
}

export async function startAccountPlanBulkJob(jobId: string): Promise<void> {
  await query(
    `UPDATE account_plan_bulk_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

export async function completeAccountPlanBulkJob(
  jobId: string,
  status: 'success' | 'partial' | 'failed',
  result: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE account_plan_bulk_jobs
        SET status = $2, completed_at = NOW(), result = $3::jsonb
      WHERE id = $1`,
    [jobId, status, JSON.stringify(result)],
  );
}

export async function listPendingBulkJobItems(
  jobId: string,
  limit: number,
): Promise<{ account_id: string }[]> {
  const r = await query<{ account_id: string }>(
    `SELECT account_id FROM account_plan_bulk_job_items
       WHERE job_id = $1 AND status = 'pending'
     ORDER BY account_id
     LIMIT $2`,
    [jobId, limit],
  );
  return r.rows;
}

export async function updateBulkJobItem(
  jobId: string,
  accountId: string,
  data: {
    status: 'success' | 'failed' | 'skipped';
    planId?: string;
    errorMessage?: string;
  },
): Promise<void> {
  await query(
    `UPDATE account_plan_bulk_job_items
        SET status = $3,
            plan_id = $4,
            error_message = $5,
            completed_at = NOW(),
            started_at = COALESCE(started_at, NOW())
      WHERE job_id = $1 AND account_id = $2`,
    [jobId, accountId, data.status, data.planId ?? null, data.errorMessage ?? null],
  );
}

export async function countBulkJobItemsByStatus(
  jobId: string,
): Promise<Record<string, number>> {
  const r = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM account_plan_bulk_job_items
      WHERE job_id = $1
      GROUP BY status`,
    [jobId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.status] = Number(row.count);
  return out;
}

export async function findActiveAccountPlanBulkJob(): Promise<{ id: string; status: string } | null> {
  const r = await query<{ id: string; status: string }>(
    `SELECT id, status FROM account_plan_bulk_jobs
       WHERE status IN ('queued', 'running')
         AND (started_at IS NULL OR started_at > NOW() - INTERVAL '2 hours')
     ORDER BY enqueued_at DESC
     LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

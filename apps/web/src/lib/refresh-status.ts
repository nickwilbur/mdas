import { query } from '@mdas/db';
import type { RefreshProgress } from '@mdas/db';

export interface RefreshJobStatus {
  id: string;
  /** Queue-row status: 'queued' | 'running' | 'success' | 'failed'. */
  status: string;
  refreshRunId: string | null;
  /** When refreshRunId is set, the orchestrator's run-level outcome. */
  runStatus: 'running' | 'success' | 'partial' | 'failed' | null;
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  rowCounts: Record<string, number> | null;
  /** Per-source non-fatal errors from the refresh, if any. */
  errorLog: { source: string; error: string }[] | null;
  /** Live progress data (per-adapter current/total + overall pct). */
  progress: RefreshProgress | null;
}

interface JoinRow {
  id: string;
  status: string;
  refresh_run_id: string | null;
  run_status: 'running' | 'success' | 'partial' | 'failed' | null;
  sources_attempted: string[] | null;
  sources_succeeded: string[] | null;
  row_counts: Record<string, number> | null;
  error_log: { source: string; error: string }[] | null;
  progress: RefreshProgress | null;
}

function rowToStatus(row: JoinRow): RefreshJobStatus {
  return {
    id: row.id,
    status: row.status,
    refreshRunId: row.refresh_run_id,
    runStatus: row.run_status,
    sourcesAttempted: row.sources_attempted ?? [],
    sourcesSucceeded: row.sources_succeeded ?? [],
    rowCounts: row.row_counts,
    errorLog: row.error_log,
    progress: row.progress ?? null,
  };
}

/** Load full refresh job status (queue row + linked run progress). */
export async function getRefreshJobStatus(jobId: string): Promise<RefreshJobStatus | null> {
  const r = await query<JoinRow>(
    `SELECT
       j.id,
       j.status,
       j.refresh_run_id,
       r.status            AS run_status,
       r.sources_attempted,
       r.sources_succeeded,
       r.row_counts,
       r.error_log,
       r.progress
     FROM refresh_jobs j
     LEFT JOIN refresh_runs r ON r.id = j.refresh_run_id
     WHERE j.id = $1`,
    [jobId],
  );
  const row = r.rows[0];
  return row ? rowToStatus(row) : null;
}

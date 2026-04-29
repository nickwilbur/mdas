import { NextResponse } from 'next/server';
import { query } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Audit ref: F-08, F-13 in docs/audit/01_findings.md.
//
// Widened 2026-04-28 (PR-A4): the prior shape returned only
// { id, status, refresh_run_id } where `status` came from the
// refresh_jobs queue row ('queued' | 'running' | 'success' | 'failed').
// That hid the worker's richer outcome — the orchestrator emits
// 'success' | 'partial' | 'failed' with a per-source success list and
// a per-adapter error log on the refresh_runs row.
//
// We now LEFT-JOIN refresh_runs so the API surfaces the run-level
// status (which is what the manager actually cares about — "did
// Cerebro silently fail?") alongside the job queue status. The
// existing { id, status } shape is preserved for backwards
// compatibility with RefreshButton's old polling code; new fields
// are additive.
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
}

export async function GET(
  _req: Request,
  ctx: { params: { jobId: string } },
): Promise<Response> {
  const r = await query<JoinRow>(
    `SELECT
       j.id,
       j.status,
       j.refresh_run_id,
       r.status            AS run_status,
       r.sources_attempted,
       r.sources_succeeded,
       r.row_counts,
       r.error_log
     FROM refresh_jobs j
     LEFT JOIN refresh_runs r ON r.id = j.refresh_run_id
     WHERE j.id = $1`,
    [ctx.params.jobId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const row = r.rows[0]!;
  const body: RefreshJobStatus = {
    id: row.id,
    status: row.status,
    refreshRunId: row.refresh_run_id,
    runStatus: row.run_status,
    sourcesAttempted: row.sources_attempted ?? [],
    sourcesSucceeded: row.sources_succeeded ?? [],
    rowCounts: row.row_counts,
    errorLog: row.error_log,
  };
  return NextResponse.json(body);
}

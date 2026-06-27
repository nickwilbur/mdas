/**
 * In-memory CSE activity snapshot jobs for POST /api/cse-activity/snapshot.
 * Snapshots read MDAS views (including glean-mcp enrichment from Refresh).
 */

export interface CseSnapshotJobProgress {
  phase: string;
  current: number;
  total: number;
  label?: string;
}

export interface CseSnapshotJobResult {
  snapshotDate: string;
  teamReportCount: number;
  dir: string;
}

export interface CseSnapshotJob {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: CseSnapshotJobProgress | null;
  result: CseSnapshotJobResult | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const jobs = new Map<string, CseSnapshotJob>();

export const CSE_SNAPSHOT_JOB_TERMINAL_TTL_MS = 5 * 60 * 1000;
export const CSE_SNAPSHOT_JOB_MAX_STORED = 50;
export const CSE_SNAPSHOT_JOB_MAX_CONCURRENT = 1;
/** Snapshot is read-only over MDAS views — should finish in under a minute. */
export const CSE_SNAPSHOT_JOB_RUNNING_STALE_MS = 10 * 60 * 1000;

export function __resetCseSnapshotJobStoreForTests(): void {
  jobs.clear();
}

function reconcileStaleRunningJob(job: CseSnapshotJob, now = Date.now()): CseSnapshotJob {
  if (job.status !== 'running') return job;
  const age = now - Date.parse(job.startedAt);
  if (age <= CSE_SNAPSHOT_JOB_RUNNING_STALE_MS) return job;
  job.status = 'error';
  job.finishedAt = new Date(now).toISOString();
  job.error =
    job.error ??
    `Snapshot timed out after ${Math.round(age / 60_000)} minutes (no completion signal)`;
  console.warn(
    JSON.stringify({
      time: new Date(now).toISOString(),
      level: 'warn',
      msg: 'cse_activity.snapshot.job.stale',
      service: 'web',
      jobId: job.id,
      ageMs: age,
    }),
  );
  return job;
}

export function pruneCseSnapshotJobs(now = Date.now()): void {
  for (const [id, job] of [...jobs.entries()]) {
    if (job.status === 'running') continue;
    if (!job.finishedAt) continue;
    if (now - Date.parse(job.finishedAt) > CSE_SNAPSHOT_JOB_TERMINAL_TTL_MS) {
      jobs.delete(id);
    }
  }
  while (jobs.size > CSE_SNAPSHOT_JOB_MAX_STORED) {
    const terminals = [...jobs.entries()].filter(([, j]) => j.status !== 'running' && j.finishedAt);
    if (terminals.length === 0) break;
    terminals.sort((a, b) => Date.parse(a[1].finishedAt!) - Date.parse(b[1].finishedAt!));
    jobs.delete(terminals[0]![0]);
  }
}

export function putCseSnapshotJob(job: CseSnapshotJob): void {
  pruneCseSnapshotJobs();
  jobs.set(job.id, job);
}

export function getCseSnapshotJob(id: string): CseSnapshotJob | undefined {
  pruneCseSnapshotJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  return reconcileStaleRunningJob(job);
}

export function countRunningCseSnapshotJobs(): number {
  pruneCseSnapshotJobs();
  let running = 0;
  for (const job of jobs.values()) {
    reconcileStaleRunningJob(job);
    if (job.status === 'running') running += 1;
  }
  return running;
}

export function findActiveCseSnapshotJob(): CseSnapshotJob | null {
  pruneCseSnapshotJobs();
  const running = [...jobs.values()]
    .filter((j) => j.status === 'running')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const job of running) {
    const reconciled = reconcileStaleRunningJob(job);
    if (reconciled.status === 'running') return reconciled;
  }
  return null;
}

export function listCseSnapshotJobsRecent(limit: number): CseSnapshotJob[] {
  pruneCseSnapshotJobs();
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

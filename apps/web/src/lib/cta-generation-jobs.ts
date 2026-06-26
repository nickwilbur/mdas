/**
 * In-memory CTA generation jobs for POST /api/ctas/generate.
 *
 * Next.js keeps route modules hot across requests; an unbounded Map
 * would retain every completed job forever (IDs, stderr tails, paths).
 * Prune terminal rows by age and cap total size so memory stays bounded.
 *
 * Child processes are registered separately and detached on close so
 * stdout/stderr listeners do not accumulate after a job finishes.
 */

import type { ChildProcess } from 'child_process';

export interface CTAJob {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: { phase: string; current: number; total: number; label?: string } | null;
  result: {
    scanDate: string;
    ctaCount: number;
    scanFilePath: string;
    logFilePath: string;
  } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const jobs = new Map<string, CTAJob>();
const childByJobId = new Map<string, ChildProcess>();

/** Test-only: clears the store (Vitest shares one module instance). */
export function __resetCtaJobStoreForTests(): void {
  for (const id of [...childByJobId.keys()]) {
    disposeCtaJobChild(id);
  }
  jobs.clear();
}

/** Completed/failed jobs older than this are dropped on prune. */
export const CTA_JOB_TERMINAL_TTL_MS = 2 * 60 * 1000;

/** Hard cap on map entries; oldest finished jobs evicted first. */
export const CTA_JOB_MAX_STORED = 100;

/** Max simultaneous child processes — prevents unbounded spawns/listeners. */
export const CTA_JOB_MAX_CONCURRENT = 2;

/**
 * Running jobs older than this are treated as zombies (worker crashed,
 * dev HMR dropped the child handler, etc.) and marked failed on read.
 * Full Expand 3 scans typically finish in minutes; 1h is a safe ceiling.
 */
export const CTA_JOB_RUNNING_STALE_MS = 60 * 60 * 1000;

function reconcileStaleRunningJob(job: CTAJob, now = Date.now()): CTAJob {
  if (job.status !== 'running') return job;
  const age = now - Date.parse(job.startedAt);
  if (age <= CTA_JOB_RUNNING_STALE_MS) return job;
  job.status = 'error';
  job.finishedAt = new Date(now).toISOString();
  job.error =
    job.error ??
    `Generation timed out after ${Math.round(age / 60_000)} minutes (no completion signal)`;
  console.warn(
    JSON.stringify({
      time: new Date(now).toISOString(),
      level: 'warn',
      msg: 'cta.job.stale',
      service: 'web',
      jobId: job.id,
      ageMs: age,
    }),
  );
  return job;
}

function detachCtaJobChild(jobId: string): void {
  const child = childByJobId.get(jobId);
  if (!child) return;
  childByJobId.delete(jobId);
  child.stdout?.removeAllListeners();
  child.stderr?.removeAllListeners();
}

/** Kill and detach a child when its job row is evicted before exit. */
export function disposeCtaJobChild(jobId: string): void {
  const child = childByJobId.get(jobId);
  if (!child) return;
  childByJobId.delete(jobId);
  child.stdout?.removeAllListeners();
  child.stderr?.removeAllListeners();
  if (child.exitCode == null && child.signalCode == null) {
    child.kill('SIGTERM');
  }
}

/**
 * Track the spawned process for a running job. Listeners are removed
 * on close/error so the web process does not retain stderr buffers.
 */
export function registerCtaJobChild(jobId: string, child: ChildProcess): void {
  childByJobId.set(jobId, child);
  const onDone = (): void => {
    detachCtaJobChild(jobId);
  };
  child.once('close', onDone);
  child.once('error', onDone);
}

export function countRunningCtaJobs(): number {
  pruneCtaJobs();
  let running = 0;
  for (const job of jobs.values()) {
    reconcileStaleRunningJob(job);
    if (job.status === 'running') running += 1;
  }
  return running;
}

function logPrune(removed: number, remaining: number): void {
  if (removed === 0) return;
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'info',
      msg: 'cta.jobs.pruned',
      service: 'web',
      removed,
      remaining,
    }),
  );
}

/**
 * Remove expired terminal jobs and enforce max size by evicting oldest
 * finished jobs. Safe to call on every read/write.
 */
export function pruneCtaJobs(now = Date.now()): { removed: number; remaining: number } {
  let removed = 0;
  for (const [id, job] of [...jobs.entries()]) {
    if (job.status === 'running') continue;
    if (!job.finishedAt) continue;
    const age = now - Date.parse(job.finishedAt);
    if (age > CTA_JOB_TERMINAL_TTL_MS) {
      disposeCtaJobChild(id);
      jobs.delete(id);
      removed++;
    }
  }

  while (jobs.size > CTA_JOB_MAX_STORED) {
    const terminals = [...jobs.entries()].filter(([, j]) => j.status !== 'running' && j.finishedAt);
    if (terminals.length === 0) break;
    terminals.sort((a, b) => Date.parse(a[1].finishedAt!) - Date.parse(b[1].finishedAt!));
    const evictId = terminals[0]![0];
    disposeCtaJobChild(evictId);
    jobs.delete(evictId);
    removed++;
  }

  const remaining = jobs.size;
  logPrune(removed, remaining);
  return { removed, remaining };
}

export function putCtaJob(job: CTAJob): void {
  pruneCtaJobs();
  jobs.set(job.id, job);
}

export function getCtaJob(id: string): CTAJob | undefined {
  pruneCtaJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  return reconcileStaleRunningJob(job);
}

/** Most recent non-stale running job, if any — for UI resume after navigation. */
export function findActiveCtaGenerationJob(): CTAJob | null {
  pruneCtaJobs();
  const running = [...jobs.values()]
    .filter((j) => j.status === 'running')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const job of running) {
    const reconciled = reconcileStaleRunningJob(job);
    if (reconciled.status === 'running') return reconciled;
  }
  return null;
}

export function listCtaJobsSortedRecent(limit: number): CTAJob[] {
  pruneCtaJobs();
  return [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

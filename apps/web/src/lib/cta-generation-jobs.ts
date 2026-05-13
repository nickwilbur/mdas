/**
 * In-memory CTA generation jobs for POST /api/ctas/generate.
 *
 * Next.js keeps route modules hot across requests; an unbounded Map
 * would retain every completed job forever (IDs, stderr tails, paths).
 * Prune terminal rows by age and cap total size so memory stays bounded.
 */

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

/** Test-only: clears the store (Vitest shares one module instance). */
export function __resetCtaJobStoreForTests(): void {
  jobs.clear();
}

/** Completed/failed jobs older than this are dropped on prune. */
export const CTA_JOB_TERMINAL_TTL_MS = 2 * 60 * 1000;

/** Hard cap on map entries; oldest finished jobs evicted first. */
export const CTA_JOB_MAX_STORED = 100;

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
      jobs.delete(id);
      removed++;
    }
  }

  while (jobs.size > CTA_JOB_MAX_STORED) {
    const terminals = [...jobs.entries()].filter(([, j]) => j.status !== 'running' && j.finishedAt);
    if (terminals.length === 0) break;
    terminals.sort((a, b) => Date.parse(a[1].finishedAt!) - Date.parse(b[1].finishedAt!));
    jobs.delete(terminals[0]![0]);
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
  return jobs.get(id);
}

export function listCtaJobsSortedRecent(limit: number): CTAJob[] {
  pruneCtaJobs();
  return [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

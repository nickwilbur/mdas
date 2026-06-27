// Shared CSE snapshot poller — one loop per jobId, multiple UI subscribers.

import type { CseSnapshotJob, CseSnapshotJobProgress } from './snapshot-jobs';

export type CseSnapshotPollCallbacks = {
  onProgress: (job: CseSnapshotJob) => void;
  onComplete: (job: CseSnapshotJob) => void;
  onPollError?: (failures: number) => void;
};

type Session = {
  jobId: string;
  abort: AbortController;
  subscribers: Map<number, CseSnapshotPollCallbacks>;
  nextId: number;
};

let session: Session | null = null;

function pollUrl(jobId: string): string {
  return `/api/cse-activity/snapshot?jobId=${encodeURIComponent(jobId)}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

function isTerminal(job: CseSnapshotJob): boolean {
  return job.status === 'done' || job.status === 'error';
}

function notifyProgress(job: CseSnapshotJob): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) cb.onProgress(job);
}

function notifyComplete(job: CseSnapshotJob): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) cb.onComplete(job);
}

function notifyPollError(failures: number): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) cb.onPollError?.(failures);
}

async function fetchJobStatus(jobId: string, signal: AbortSignal): Promise<CseSnapshotJob | null> {
  const res = await fetch(pollUrl(jobId), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as CseSnapshotJob;
}

async function pollLoop(sess: Session): Promise<void> {
  const { abort } = sess;
  const POLL_DEADLINE = Date.now() + 50 * 60 * 1000;
  let pollIdx = 0;
  let pollFailures = 0;
  let lastStatus: CseSnapshotJob | null = null;

  try {
    while (!abort.signal.aborted && Date.now() < POLL_DEADLINE) {
      const job = await fetchJobStatus(sess.jobId, abort.signal).catch(() => null);
      if (abort.signal.aborted) break;

      if (job) {
        pollFailures = 0;
        lastStatus = job;
        notifyProgress(job);
        if (isTerminal(job)) {
          notifyComplete(job);
          return;
        }
      } else {
        pollFailures += 1;
        notifyPollError(pollFailures);
        if (pollFailures >= 5 && lastStatus) {
          notifyComplete({
            ...lastStatus,
            status: 'error',
            finishedAt: new Date().toISOString(),
            error: 'Lost connection to snapshot status — reload to check if it finished',
          });
          return;
        }
      }

      const interval = pollIdx < 12 ? 500 : 2000;
      pollIdx += 1;
      try {
        await sleep(interval, abort.signal);
      } catch {
        break;
      }
    }

    if (!abort.signal.aborted && lastStatus && !isTerminal(lastStatus)) {
      notifyComplete({
        ...lastStatus,
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: 'Snapshot status polling timed out — reload to check results',
      });
    }
  } finally {
    if (session === sess) session = null;
  }
}

export function formatSnapshotProgress(job: CseSnapshotJob): string {
  const p = job.progress;
  if (!p) return job.status;

  if (p.total <= 0) return p.label ?? job.status;
  const pct = Math.round((p.current / p.total) * 100);
  const phaseLabel =
    p.phase === 'load_mdas'
      ? 'Loading MDAS'
      : p.phase === 'build_snapshot'
        ? 'Building'
        : p.phase;
  return `${pct}% — ${phaseLabel}${p.label ? `: ${p.label}` : ''}`;
}

export function subscribeCseSnapshotJobPoll(
  jobId: string,
  callbacks: CseSnapshotPollCallbacks,
): () => void {
  if (session?.jobId !== jobId) {
    session?.abort.abort();
    session = {
      jobId,
      abort: new AbortController(),
      subscribers: new Map(),
      nextId: 0,
    };
    void pollLoop(session);
  }

  const id = session.nextId++;
  session.subscribers.set(id, callbacks);

  return () => {
    if (!session) return;
    session.subscribers.delete(id);
    if (session.subscribers.size === 0) {
      session.abort.abort();
      session = null;
    }
  };
}

export type { CseSnapshotJob, CseSnapshotJobProgress };

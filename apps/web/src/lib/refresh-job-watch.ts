// Shared refresh-job poller — one loop per jobId, multiple UI subscribers.
// Stops when the last subscriber unmounts so navigation doesn't leave
// orphaned fetch/setState loops running in the background.

export interface AdapterProgress {
  status: 'pending' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  label?: string;
}

export interface RefreshProgress {
  adapters?: Record<string, AdapterProgress>;
  pct?: number;
}

export interface RefreshJobStatus {
  id: string;
  status: string;
  runStatus: 'running' | 'success' | 'partial' | 'failed' | null;
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  errorLog: { source: string; error: string }[] | null;
  progress: RefreshProgress | null;
}

export type RefreshPollCallbacks = {
  onProgress: (progress: RefreshProgress | null, pct: number, queueStatus?: string) => void;
  onComplete: (status: RefreshJobStatus) => void;
  /** Called when a poll request fails (timeout, non-OK, network). */
  onPollError?: (failures: number) => void;
};

type Session = {
  jobId: string;
  abort: AbortController;
  subscribers: Map<number, RefreshPollCallbacks>;
  nextId: number;
};

let session: Session | null = null;

function refreshJobPollUrl(jobId: string): string {
  return `/api/refresh?jobId=${encodeURIComponent(jobId)}`;
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

function isTerminal(sj: RefreshJobStatus): boolean {
  return (
    sj.runStatus === 'success' ||
    sj.runStatus === 'partial' ||
    sj.runStatus === 'failed' ||
    sj.status === 'failed'
  );
}

function notifyProgress(sj: RefreshJobStatus): void {
  if (!session) return;
  const pct = sj.progress?.pct ?? 0;
  for (const cb of session.subscribers.values()) {
    cb.onProgress(sj.progress, pct, sj.status);
  }
}

function notifyComplete(sj: RefreshJobStatus): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) {
    cb.onComplete(sj);
  }
}

function notifyPollError(failures: number): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) {
    cb.onPollError?.(failures);
  }
}

async function fetchJobStatus(jobId: string, signal: AbortSignal): Promise<RefreshJobStatus | null> {
  const s = await fetch(refreshJobPollUrl(jobId), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: 'no-store',
  });
  if (!s.ok) return null;
  return (await s.json()) as RefreshJobStatus;
}

async function pollOnce(sess: Session): Promise<RefreshJobStatus | null> {
  try {
    return await fetchJobStatus(sess.jobId, sess.abort.signal);
  } catch {
    return null;
  }
}

async function pollLoop(sess: Session): Promise<void> {
  const { abort } = sess;
  const POLL_DEADLINE = Date.now() + 40 * 60 * 1000;
  let pollIdx = 0;
  let pollFailures = 0;
  let lastStatus: RefreshJobStatus | null = null;

  try {
    while (!abort.signal.aborted && Date.now() < POLL_DEADLINE) {
      const sj = await pollOnce(sess);
      if (abort.signal.aborted) break;

      if (sj) {
        pollFailures = 0;
        lastStatus = sj;
        notifyProgress(sj);
        if (isTerminal(sj)) {
          notifyComplete(sj);
          return;
        }
      } else {
        pollFailures += 1;
        notifyPollError(pollFailures);
      }

      const interval = pollIdx < 12 ? 500 : 2000;
      pollIdx += 1;
      try {
        await sleep(interval, abort.signal);
      } catch {
        break;
      }
    }

    if (!abort.signal.aborted && lastStatus) {
      notifyComplete({
        ...lastStatus,
        status: 'failed',
        runStatus: 'failed',
      });
    }
  } finally {
    if (session === sess) {
      session = null;
    }
  }
}

/** Subscribe to refresh job status updates. Returns an unsubscribe function. */
export function subscribeRefreshJobPoll(
  jobId: string,
  callbacks: RefreshPollCallbacks,
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

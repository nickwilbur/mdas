// Shared CTA generation poller — one loop per jobId, multiple UI subscribers.
// Uses GET /api/ctas/generate?jobId=… (query param) instead of the dynamic
// [jobId] route, which can hang indefinitely in Next dev.

export interface CtaGenerationProgress {
  phase: string;
  current: number;
  total: number;
  label?: string;
}

export interface CtaGenerationJobStatus {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: CtaGenerationProgress | null;
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

export type CtaGenerationPollCallbacks = {
  onProgress: (job: CtaGenerationJobStatus) => void;
  onComplete: (job: CtaGenerationJobStatus) => void;
  /** Called when a poll request fails (timeout, non-OK, network). */
  onPollError?: (failures: number) => void;
};

type Session = {
  jobId: string;
  abort: AbortController;
  subscribers: Map<number, CtaGenerationPollCallbacks>;
  nextId: number;
};

let session: Session | null = null;

function ctaJobPollUrl(jobId: string): string {
  return `/api/ctas/generate?jobId=${encodeURIComponent(jobId)}`;
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

function isTerminal(job: CtaGenerationJobStatus): boolean {
  return job.status === 'done' || job.status === 'error';
}

function notifyProgress(job: CtaGenerationJobStatus): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) {
    cb.onProgress(job);
  }
}

function notifyComplete(job: CtaGenerationJobStatus): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) {
    cb.onComplete(job);
  }
}

function notifyPollError(failures: number): void {
  if (!session) return;
  for (const cb of session.subscribers.values()) {
    cb.onPollError?.(failures);
  }
}

async function fetchJobStatus(
  jobId: string,
  signal: AbortSignal,
): Promise<CtaGenerationJobStatus | null> {
  const res = await fetch(ctaJobPollUrl(jobId), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as CtaGenerationJobStatus;
}

async function pollOnce(sess: Session): Promise<CtaGenerationJobStatus | null> {
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
  let lastStatus: CtaGenerationJobStatus | null = null;

  try {
    while (!abort.signal.aborted && Date.now() < POLL_DEADLINE) {
      const job = await pollOnce(sess);
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
            error: 'Lost connection to generation status — reload to check if it finished',
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
        error: 'Generation status polling timed out — reload to check results',
      });
    }
  } finally {
    if (session === sess) {
      session = null;
    }
  }
}

/** Subscribe to CTA generation job status updates. Returns an unsubscribe function. */
export function subscribeCtaGenerationJobPoll(
  jobId: string,
  callbacks: CtaGenerationPollCallbacks,
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

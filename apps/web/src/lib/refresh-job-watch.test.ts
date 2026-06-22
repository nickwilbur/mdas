import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRefreshJobPoll, type RefreshJobStatus } from './refresh-job-watch';

function runningJob(pct: number): RefreshJobStatus {
  return {
    id: 'job-1',
    status: 'running',
    runStatus: 'running',
    sourcesAttempted: [],
    sourcesSucceeded: [],
    errorLog: null,
    progress: { pct },
  };
}

function doneJob(): RefreshJobStatus {
  return {
    id: 'job-1',
    status: 'success',
    runStatus: 'success',
    sourcesAttempted: ['salesforce'],
    sourcesSucceeded: ['salesforce'],
    errorLog: null,
    progress: { pct: 100 },
  };
}

describe('subscribeRefreshJobPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops polling when the last subscriber unsubscribes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => runningJob(10),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const unsub = subscribeRefreshJobPoll('job-1', { onProgress, onComplete });

    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/refresh?jobId=job-1',
      expect.objectContaining({ cache: 'no-store' }),
    );

    fetchMock.mockClear();
    unsub();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('notifies subscribers through completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => runningJob(50),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => doneJob(),
      });
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    subscribeRefreshJobPoll('job-1', { onProgress, onComplete });

    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(600);

    expect(onProgress).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ runStatus: 'success' }));
  });
});

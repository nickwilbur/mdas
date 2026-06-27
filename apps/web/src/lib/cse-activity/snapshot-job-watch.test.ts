import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSnapshotProgress, subscribeCseSnapshotJobPoll } from './snapshot-job-watch';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe('formatSnapshotProgress', () => {
  it('formats load and build phases with percent', () => {
    const text = formatSnapshotProgress({
      id: 'j1',
      status: 'running',
      progress: { phase: 'load_mdas', current: 2, total: 3, label: 'Glean enrichment fresh' },
      result: null,
      error: null,
      startedAt: '',
      finishedAt: null,
    });
    expect(text).toBe('67% — Loading MDAS: Glean enrichment fresh');
  });
});

describe('subscribeCseSnapshotJobPoll', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('notifies on progress then completes on done', async () => {
    const jobId = 'snap-1';
    const running = {
      id: jobId,
      status: 'running' as const,
      progress: { phase: 'build_snapshot', current: 0, total: 1, label: 'Building reports…' },
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const done = {
      ...running,
      status: 'done' as const,
      progress: { phase: 'done', current: 1, total: 1, label: '2026-06-26' },
      result: { snapshotDate: '2026-06-26', teamReportCount: 6, dir: '/tmp' },
      finishedAt: new Date().toISOString(),
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(running))
      .mockResolvedValueOnce(jsonResponse(done));

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const unsub = subscribeCseSnapshotJobPoll(jobId, { onProgress, onComplete });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });
    unsub();

    expect(onProgress).toHaveBeenCalled();
    expect(onComplete.mock.calls[0]![0].status).toBe('done');
    expect(fetch).toHaveBeenCalledWith(
      `/api/cse-activity/snapshot?jobId=${encodeURIComponent(jobId)}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

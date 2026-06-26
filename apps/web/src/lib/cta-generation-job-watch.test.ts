import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeCtaGenerationJobPoll } from './cta-generation-job-watch.js';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe('subscribeCtaGenerationJobPoll', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('notifies on progress then completes on done', async () => {
    const jobId = 'job-abc';
    const running = {
      id: jobId,
      status: 'running' as const,
      progress: { phase: 'classify', current: 2, total: 10, label: 'Acme' },
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const done = {
      ...running,
      status: 'done' as const,
      progress: { phase: 'done', current: 10, total: 10 },
      result: {
        scanDate: '2026-06-25',
        ctaCount: 3,
        scanFilePath: 'expand3_cta_scan_2026-06-25.md',
        logFilePath: 'expand3_cta_log.jsonl',
      },
      finishedAt: new Date().toISOString(),
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(running))
      .mockResolvedValueOnce(jsonResponse(done));

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const unsub = subscribeCtaGenerationJobPoll(jobId, { onProgress, onComplete });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 5000 });
    unsub();

    expect(onProgress).toHaveBeenCalled();
    expect(onComplete.mock.calls[0]![0].status).toBe('done');
    expect(fetch).toHaveBeenCalledWith(
      `/api/ctas/generate?jobId=${encodeURIComponent(jobId)}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('shares one poll loop for multiple subscribers on the same job', async () => {
    const jobId = 'job-shared';
    const done = {
      id: jobId,
      status: 'done' as const,
      progress: null,
      result: { scanDate: '2026-06-25', ctaCount: 1, scanFilePath: 'a.md', logFilePath: 'b.jsonl' },
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    vi.mocked(fetch).mockResolvedValue(jsonResponse(done));

    const completeA = vi.fn();
    const completeB = vi.fn();
    const unsubA = subscribeCtaGenerationJobPoll(jobId, {
      onProgress: vi.fn(),
      onComplete: completeA,
    });
    const unsubB = subscribeCtaGenerationJobPoll(jobId, {
      onProgress: vi.fn(),
      onComplete: completeB,
    });

    await vi.waitFor(() => expect(completeA).toHaveBeenCalled() && expect(completeB).toHaveBeenCalled());
    unsubA();
    unsubB();

    // One poll cycle should satisfy both subscribers.
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(2);
  });
});

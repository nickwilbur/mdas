import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpdateRefreshProgress } = vi.hoisted(() => ({
  mockUpdateRefreshProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@mdas/db', () => ({
  updateRefreshProgress: mockUpdateRefreshProgress,
}));

import { ProgressTracker } from './progress-tracker.js';

describe('ProgressTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUpdateRefreshProgress.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule DB flush until startFlushing', async () => {
    const p = new ProgressTracker('rid', ['a']);
    p.markRunning('a', 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockUpdateRefreshProgress).not.toHaveBeenCalled();
  });

  it('stops periodic flush after stopFlushing', async () => {
    const p = new ProgressTracker('rid', ['sf']);
    p.markRunning('sf', 10);
    p.startFlushing();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockUpdateRefreshProgress).toHaveBeenCalled();
    const n = mockUpdateRefreshProgress.mock.calls.length;
    p.stopFlushing();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockUpdateRefreshProgress.mock.calls.length).toBe(n);
  });
});

import { describe, expect, it } from 'vitest';
import { createCerebroRestStatsCollector } from './stats.js';

describe('createCerebroRestStatsCollector', () => {
  it('tracks requests, retries, and per-intent latency', () => {
    const stats = createCerebroRestStatsCollector();
    stats.record('cerebro:account-details', 120);
    stats.record('cerebro:account-details', 80);
    stats.record('cerebro:account-details', 0, { retry: true });
    stats.record('cerebro:whoami', 50, { error: true });

    const snap = stats.snapshot();
    expect(snap.requestCount).toBe(3);
    expect(snap.retryCount).toBe(1);
    expect(snap.totalDurationMs).toBe(250);
    expect(snap.byIntent['cerebro:account-details']).toMatchObject({
      count: 2,
      durationMs: 200,
      errors: 0,
    });
    expect(snap.byIntent['cerebro:whoami']).toMatchObject({
      count: 1,
      durationMs: 50,
      errors: 1,
    });
  });
});

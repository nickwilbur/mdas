// Per-refresh HTTP stats for Cerebro REST — surfaced in worker logs.

export interface CerebroRestIntentStats {
  count: number;
  durationMs: number;
  errors: number;
}

export interface CerebroRestStats {
  requestCount: number;
  retryCount: number;
  totalDurationMs: number;
  byIntent: Record<string, CerebroRestIntentStats>;
}

export type CerebroRestStatsCollector = CerebroRestStats & {
  record(intent: string, durationMs: number, opts?: { error?: boolean; retry?: boolean }): void;
  snapshot(): CerebroRestStats;
};

export function createCerebroRestStatsCollector(): CerebroRestStatsCollector {
  const byIntent: Record<string, CerebroRestIntentStats> = {};
  const state = {
    requestCount: 0,
    retryCount: 0,
    totalDurationMs: 0,
    byIntent,
    record(intent: string, durationMs: number, opts?: { error?: boolean; retry?: boolean }) {
      if (opts?.retry) {
        this.retryCount += 1;
        return;
      }
      this.requestCount += 1;
      this.totalDurationMs += durationMs;
      const bucket = byIntent[intent] ?? { count: 0, durationMs: 0, errors: 0 };
      bucket.count += 1;
      bucket.durationMs += durationMs;
      if (opts?.error) bucket.errors += 1;
      byIntent[intent] = bucket;
    },
    snapshot(): CerebroRestStats {
      return {
        requestCount: this.requestCount,
        retryCount: this.retryCount,
        totalDurationMs: this.totalDurationMs,
        byIntent: { ...byIntent },
      };
    },
  };
  return state;
}

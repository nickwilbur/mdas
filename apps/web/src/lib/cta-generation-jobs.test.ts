import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCtaJobStoreForTests,
  CTA_JOB_MAX_STORED,
  CTA_JOB_TERMINAL_TTL_MS,
  getCtaJob,
  listCtaJobsSortedRecent,
  pruneCtaJobs,
  putCtaJob,
  type CTAJob,
} from './cta-generation-jobs.js';

/** Wall clock for prune tests — must match synthetic job timestamps. */
const PRUNE_TEST_NOW = Date.parse('2026-01-15T12:00:00.000Z');

beforeEach(() => {
  __resetCtaJobStoreForTests();
  vi.spyOn(Date, 'now').mockReturnValue(PRUNE_TEST_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeJob(
  id: string,
  status: CTAJob['status'],
  startedAt: string,
  finishedAt: string | null,
): CTAJob {
  return {
    id,
    status,
    progress: null,
    result: null,
    error: null,
    startedAt,
    finishedAt,
  };
}

describe('pruneCtaJobs', () => {
  it('removes terminal jobs older than TTL', () => {
    const oldFinished = new Date(PRUNE_TEST_NOW - CTA_JOB_TERMINAL_TTL_MS - 1000).toISOString();
    putCtaJob(makeJob('a', 'done', '2026-01-01T00:00:00.000Z', oldFinished));
    const { removed } = pruneCtaJobs(PRUNE_TEST_NOW);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(getCtaJob('a')).toBeUndefined();
  });

  it('retains running jobs regardless of age', () => {
    const stale = new Date(PRUNE_TEST_NOW - CTA_JOB_TERMINAL_TTL_MS * 10).toISOString();
    putCtaJob(makeJob('run-1', 'running', stale, null));
    pruneCtaJobs(PRUNE_TEST_NOW);
    expect(getCtaJob('run-1')?.status).toBe('running');
  });

  it('evicts oldest finished jobs when over max stored', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const now = PRUNE_TEST_NOW;
    for (let i = 0; i < CTA_JOB_MAX_STORED + 5; i++) {
      const started = new Date(now - 60_000 + i).toISOString();
      const finishedAt = new Date(now - 30_000 + i).toISOString();
      putCtaJob(makeJob(`j${i}`, 'done', started, finishedAt));
    }
    pruneCtaJobs(now);
    expect(listCtaJobsSortedRecent(500).length).toBe(CTA_JOB_MAX_STORED);
  });
});

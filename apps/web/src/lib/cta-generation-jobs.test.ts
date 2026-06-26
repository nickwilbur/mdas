import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  __resetCtaJobStoreForTests,
  CTA_JOB_MAX_CONCURRENT,
  CTA_JOB_MAX_STORED,
  CTA_JOB_RUNNING_STALE_MS,
  CTA_JOB_TERMINAL_TTL_MS,
  countRunningCtaJobs,
  disposeCtaJobChild,
  findActiveCtaGenerationJob,
  getCtaJob,
  listCtaJobsSortedRecent,
  pruneCtaJobs,
  putCtaJob,
  registerCtaJobChild,
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

describe('countRunningCtaJobs', () => {
  it('counts only running jobs', () => {
    putCtaJob(makeJob('run-a', 'running', '2026-01-15T11:00:00.000Z', null));
    putCtaJob(makeJob('done-a', 'done', '2026-01-15T10:00:00.000Z', '2026-01-15T10:05:00.000Z'));
    expect(countRunningCtaJobs()).toBe(1);
  });

  it('respects concurrent cap constant', () => {
    for (let i = 0; i < CTA_JOB_MAX_CONCURRENT; i++) {
      putCtaJob(makeJob(`run-${i}`, 'running', '2026-01-15T11:00:00.000Z', null));
    }
    expect(countRunningCtaJobs()).toBe(CTA_JOB_MAX_CONCURRENT);
  });

  it('does not count stale running jobs', () => {
    const staleStart = new Date(PRUNE_TEST_NOW - CTA_JOB_RUNNING_STALE_MS - 60_000).toISOString();
    putCtaJob(makeJob('stale-run', 'running', staleStart, null));
    expect(countRunningCtaJobs()).toBe(0);
    expect(getCtaJob('stale-run')?.status).toBe('error');
  });
});

describe('findActiveCtaGenerationJob', () => {
  it('returns the newest non-stale running job', () => {
    putCtaJob(makeJob('run-old', 'running', '2026-01-15T10:00:00.000Z', null));
    putCtaJob(makeJob('run-new', 'running', '2026-01-15T11:00:00.000Z', null));
    expect(findActiveCtaGenerationJob()?.id).toBe('run-new');
  });

  it('returns null when only stale running jobs exist', () => {
    const staleStart = new Date(PRUNE_TEST_NOW - CTA_JOB_RUNNING_STALE_MS - 60_000).toISOString();
    putCtaJob(makeJob('stale-run', 'running', staleStart, null));
    expect(findActiveCtaGenerationJob()).toBeNull();
  });
});

function mockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('registerCtaJobChild', () => {
  it('strips stdout/stderr listeners after close', () => {
    const child = mockChild();
    const stdoutSpy = vi.spyOn(child.stdout!, 'removeAllListeners');
    registerCtaJobChild('job-1', child);
    child.stdout!.on('data', () => {});
    child.emit('close', 0);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('disposeCtaJobChild kills a live process', () => {
    const child = mockChild();
    registerCtaJobChild('job-2', child);
    disposeCtaJobChild('job-2');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

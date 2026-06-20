import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { updateCtaStatus } from './cta-log.js';

vi.mock('./cta-project-root.js', () => ({
  ctaLogPath: () => join(process.env.CTA_LOG_TEST_DIR!, 'expand3_cta_log.jsonl'),
}));

describe('updateCtaStatus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cta-log-test-'));
    process.env.CTA_LOG_TEST_DIR = dir;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T15:00:00.000Z'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CTA_LOG_TEST_DIR;
    vi.useRealTimers();
  });

  it('returns error when log file is missing', () => {
    expect(updateCtaStatus('expand3-2026-06-16-acme-dark_account', 'closed_done')).toEqual({
      ok: false,
      error: 'CTA log not found',
    });
  });

  it('returns error when cta_id is not in the log', () => {
    writeFileSync(
      join(dir, 'expand3_cta_log.jsonl'),
      `${JSON.stringify({ cta_id: 'other-id', status: 'open' })}\n`,
    );
    expect(updateCtaStatus('missing-id', 'stalled')).toEqual({
      ok: false,
      error: 'CTA not found',
    });
  });

  it('updates matching line and sets closed_at for closed_done', () => {
    const existing = {
      cta_id: 'expand3-2026-06-16-acme-dark_account',
      status: 'open',
      account_name: 'Acme',
    };
    writeFileSync(
      join(dir, 'expand3_cta_log.jsonl'),
      `${JSON.stringify(existing)}\n${JSON.stringify({ cta_id: 'keep-me', status: 'open' })}\n`,
    );

    const result = updateCtaStatus(existing.cta_id, 'closed_done');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.entry.status).toBe('closed_done');
    expect(result.entry.closed_at).toBe('2026-06-16T15:00:00.000Z');
    expect(result.entry.last_checked_at).toBe('2026-06-16T15:00:00.000Z');
    expect(result.entry.account_name).toBe('Acme');

    const lines = readFileSync(join(dir, 'expand3_cta_log.jsonl'), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0].cta_id).toBe(existing.cta_id);
    expect(lines[0].status).toBe('closed_done');
    expect(lines[1].cta_id).toBe('keep-me');
    expect(lines[1].status).toBe('open');
  });

  it('clears closed_at when moving back to open', () => {
    writeFileSync(
      join(dir, 'expand3_cta_log.jsonl'),
      `${JSON.stringify({
        cta_id: 'cta-1',
        status: 'closed_done',
        closed_at: '2026-06-01T00:00:00.000Z',
      })}\n`,
    );

    const result = updateCtaStatus('cta-1', 'open');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.status).toBe('open');
    expect(result.entry.closed_at).toBeNull();
  });

  it('preserves malformed lines while updating the target row', () => {
    writeFileSync(
      join(dir, 'expand3_cta_log.jsonl'),
      `not-json\n${JSON.stringify({ cta_id: 'cta-1', status: 'open' })}\n`,
    );

    const result = updateCtaStatus('cta-1', 'stalled');
    expect(result.ok).toBe(true);

    const raw = readFileSync(join(dir, 'expand3_cta_log.jsonl'), 'utf-8');
    expect(raw.startsWith('not-json\n')).toBe(true);
    expect(JSON.parse(raw.trim().split('\n')[1]!).status).toBe('stalled');
  });
});

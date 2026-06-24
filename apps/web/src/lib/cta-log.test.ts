import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SAMPLE_ENTRY = {
  cta_id: 'test-cta-001',
  account_name: 'TestCo',
  salesforce_account_id: '001TEST',
  renewal_opportunity_id: '006TEST',
  play_type: 'dark_renewal',
  dedup_key: '006TEST:dark_renewal',
  risk_color: 'Red',
  primary_owner: { name: 'Jane', role: 'CSE' },
  deadline: '2026-08-01',
  posted_at: '2026-06-01T12:00:00Z',
  posted_to_channel: '#expand3-risk-signals',
  status: 'open',
  last_checked_at: null,
  escalation_message_id: null,
};

describe('cta-log progress updates', () => {
  let tmpRoot: string;
  let logPath: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `mdas-cta-log-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    logPath = join(tmpRoot, 'expand3_cta_log.jsonl');
    writeFileSync(logPath, `${JSON.stringify(SAMPLE_ENTRY)}\n`);
    process.env.MDAS_CTA_LOG_PATH = logPath;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.MDAS_CTA_LOG_PATH;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('updates status and sets completed_at when done', async () => {
    const { updateCtaProgress, readCtaLog } = await import('./cta-log');
    const result = updateCtaProgress('test-cta-001', { status: 'done' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.status).toBe('done');
    expect(result.entry.completed_at).toBeTruthy();

    const all = readCtaLog();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('done');
  });

  it('updates owner and progress note', async () => {
    const { updateCtaProgress } = await import('./cta-log');
    const result = updateCtaProgress('test-cta-001', {
      assigned_owner: 'Alex AE',
      progress_note: 'Scheduled exec sync',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.assigned_owner).toBe('Alex AE');
    expect(result.entry.progress_note).toBe('Scheduled exec sync');
    expect(result.entry.updated_at).toBeTruthy();
  });

  it('backfills renewal_opportunity_id from URL', async () => {
    const { backfillCtaLogOpportunityIds, readCtaLog } = await import('./cta-log');
    const result = backfillCtaLogOpportunityIds();
    expect(result.total).toBe(1);
    expect(result.updated).toBe(0);

    writeFileSync(
      logPath,
      `${JSON.stringify({
        ...SAMPLE_ENTRY,
        renewal_opportunity_id: undefined,
        renewal_opportunity_url:
          'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000FROMURL/view',
      })}\n`,
    );
    vi.resetModules();
    const backfill = (await import('./cta-log')).backfillCtaLogOpportunityIds();
    expect(backfill.updated).toBe(1);
    const entries = (await import('./cta-log')).readCtaLog();
    expect(entries[0]?.renewal_opportunity_id).toBe('006Po00000FROMURL');
  });
});

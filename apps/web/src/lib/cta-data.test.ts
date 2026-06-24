import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SAMPLE_SCAN_MD = [
  '# Expand 3 CTA Scan — 2026-06-24',
  '',
  '## CTA 1 — TestCo',
  '',
  '```json',
  JSON.stringify({
    cta_id: 'expand3-2026-06-24-testco-dark_account',
    account_name: 'TestCo',
    salesforce_account_id: '001TEST',
    play_type: 'dark_account',
    risk_color: 'Red',
    primary_owner: { name: 'Jane', role: 'CSE' },
    deadline: '2026-08-01',
    renewal_opportunity_id: '006Po00000RENEWAL1',
    renewal_opportunity_url:
      'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000RENEWAL1/view',
    dedup_key: '006Po00000RENEWAL1:dark_account',
  }, null, 2),
  '```',
  '',
].join('\n');

describe('loadCTAData progress overlay', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `mdas-cta-data-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(join(tmpRoot, 'expand3_cta_scan_2026-06-24.md'), SAMPLE_SCAN_MD);
    writeFileSync(
      join(tmpRoot, 'expand3_cta_log.jsonl'),
      `${JSON.stringify({
        cta_id: 'expand3-2026-06-16-testco-dark_account',
        account_name: 'TestCo',
        salesforce_account_id: '001TEST',
        play_type: 'dark_account',
        renewal_opportunity_id: '006Po00000RENEWAL1',
        dedup_key: '006Po00000RENEWAL1:dark_account',
        posted_at: '2026-06-16T12:00:00Z',
        posted_to_channel: '#expand3-risk-signals',
        status: 'in_progress',
        progress_note: 'Left voicemail',
        deadline: '2026-08-01',
        last_checked_at: '2026-06-20T12:00:00Z',
        escalation_message_id: null,
      })}\n`,
    );
    process.env.MDAS_CTA_PROJECT_ROOT = tmpRoot;
    process.env.MDAS_CTA_LOG_PATH = join(tmpRoot, 'expand3_cta_log.jsonl');
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.MDAS_CTA_PROJECT_ROOT;
    delete process.env.MDAS_CTA_LOG_PATH;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('overlays progress from JSONL via dedup_key when scan cta_id changed', async () => {
    const { loadCTAData } = await import('./cta-data');
    const { ctas } = loadCTAData();
    expect(ctas).toHaveLength(1);
    expect(ctas[0]?.cta_id).toBe('expand3-2026-06-24-testco-dark_account');
    expect(ctas[0]?.status).toBe('in_progress');
    expect(ctas[0]?.progress_note).toBe('Left voicemail');
  });
});

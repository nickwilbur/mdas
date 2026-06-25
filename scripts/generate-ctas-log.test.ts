import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mergeCTAUpdate, type CTARecord, type CTALogEntry } from '@mdas/cta-engine';

function makeLogEntry(overrides: Partial<CTALogEntry> = {}): CTALogEntry {
  return {
    cta_id: 'cta-001',
    account_name: 'Acme',
    salesforce_account_id: '001',
    play_type: 'utilization_risk',
    risk_color: 'Red',
    destination_slack_channel: 'https://zuora.slack.com/archives/C123',
    renewal_opportunity_url: null,
    posted_at: '2026-06-10T12:00:00Z',
    posted_to_channel: '#expand3-risk-signals',
    status: 'open',
    deadline: '2026-07-01',
    check_back_date: '2026-06-15',
    last_checked_at: null,
    escalation_message_id: null,
    priority_score: 40,
    drivers: ['Low usage'],
    ...overrides,
  };
}

function makeCTA(overrides: Partial<CTARecord> = {}): CTARecord {
  return {
    cta_id: 'cta-001',
    account_name: 'Acme',
    salesforce_account_id: '001',
    play_type: 'utilization_risk',
    risk_color: 'Red',
    primary_owner: { name: 'Jane', role: 'AE' },
    cc_owners: [],
    destination_slack_channel: 'https://zuora.slack.com/archives/C123',
    renewal_opportunity_url: null,
    drivers: ['Usage dropped sharply'],
    requested_action: 'Investigate',
    deadline: '2026-07-01',
    check_back_date: '2026-06-15',
    expected_artifact: 'Usage report',
    priority_score: 75,
    ...overrides,
  };
}

describe('incremental CTA log updates', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cta-log-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends an updated entry so readExistingLog-style last-write wins', () => {
    const logPath = join(dir, 'expand3_cta_log.jsonl');
    const existing = makeLogEntry();
    writeFileSync(logPath, JSON.stringify(existing) + '\n', 'utf-8');

    const fresh = makeCTA({ priority_score: 75, drivers: ['Usage dropped sharply'] });
    const updated = mergeCTAUpdate(existing, fresh, '2026-06-12');
    writeFileSync(logPath, readFileSync(logPath, 'utf-8') + JSON.stringify(updated) + '\n', 'utf-8');

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const byId = new Map<string, CTALogEntry>();
    for (const line of lines) {
      const entry = JSON.parse(line) as CTALogEntry;
      byId.set(entry.cta_id, entry);
    }

    expect(byId.get('cta-001')?.priority_score).toBe(75);
    expect(byId.get('cta-001')?.drivers).toEqual(['Usage dropped sharply']);
    expect(byId.get('cta-001')?.posted_at).toBe(existing.posted_at);
    expect(byId.get('cta-001')?.last_checked_at).toMatch(/^2026-06-12T/);
  });
});

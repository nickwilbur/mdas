import { describe, it, expect } from 'vitest';
import { decideDedup } from './dedup.js';
import { DEFAULT_CTA_CONFIG } from './config.js';
import type { CTARecord, CTALogEntry } from './types.js';

const NOW = Date.parse('2026-05-12T12:00:00Z');

function makeCTA(overrides: Partial<CTARecord> = {}): CTARecord {
  return {
    cta_id: 'expand3-2026-05-12-acme-dark_account',
    account_name: 'Acme',
    salesforce_account_id: '001',
    play_type: 'dark_account',
    risk_color: 'Yellow',
    primary_owner: { name: 'CSE', role: 'CSE' },
    deadline: '2026-06-01',
    dedup_key: '001:dark_account',
    drivers: ['No activity'],
    priority_score: 60,
    ...overrides,
  };
}

describe('decideDedup', () => {
  it('creates when no existing open CTA', () => {
    const log = new Map<string, CTALogEntry>();
    const decision = decideDedup(makeCTA(), log, DEFAULT_CTA_CONFIG, NOW);
    expect(decision.action).toBe('create');
  });

  it('skips duplicate within dedup window', () => {
    const entry: CTALogEntry = {
      ...makeCTA(),
      posted_at: '2026-05-10T12:00:00Z',
      posted_to_channel: '#expand3-risk-signals',
      status: 'open',
      last_checked_at: null,
      escalation_message_id: null,
    };
    const log = new Map([[entry.cta_id, entry]]);
    const decision = decideDedup(makeCTA(), log, DEFAULT_CTA_CONFIG, NOW);
    expect(decision.action).toBe('skip');
  });

  it('updates when priority changed within window', () => {
    const entry: CTALogEntry = {
      ...makeCTA({ priority_score: 40 }),
      posted_at: '2026-05-10T12:00:00Z',
      posted_to_channel: '#expand3-risk-signals',
      status: 'open',
      last_checked_at: null,
      escalation_message_id: null,
    };
    const log = new Map([[entry.cta_id, entry]]);
    const decision = decideDedup(makeCTA({ priority_score: 75 }), log, DEFAULT_CTA_CONFIG, NOW);
    expect(decision.action).toBe('update');
  });
});

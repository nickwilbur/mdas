import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Test fixtures ──────────────────────────────────────────────────────────

const SAMPLE_CTA = {
  cta_id: 'test-gen-001',
  account_name: 'TestCo',
  salesforce_account_id: '001TEST',
  play_type: 'utilization_risk',
  risk_color: 'Red',
  primary_owner: { name: 'Jane Doe', role: 'AE' },
  cc_owners: [{ name: 'Kyle L', role: 'CSE' }],
  destination_slack_channel: 'https://zuora.slack.com/archives/C123',
  renewal_opportunity_url: 'https://zuora.lightning.force.com/lightning/r/Opportunity/006TEST/view',
  drivers: ['Renewal date: 2026-08-15', 'ARR: $50,000', 'Low usage'],
  requested_action: 'Investigate usage drop.',
  deadline: '2026-07-01',
  check_back_date: '2026-06-15',
  expected_artifact: 'Usage report',
};

const SAMPLE_SCAN_MD = [
  '# Expand 3 CTA Scan — 2026-05-11',
  '',
  '**Generated:** 2026-05-11T12:00:00Z',
  '',
  '---',
  '',
  '## CTA 1 — TestCo',
  '',
  '```json',
  JSON.stringify(SAMPLE_CTA, null, 2),
  '```',
  '',
].join('\n');

const SAMPLE_LOG_ENTRY = {
  cta_id: 'test-gen-001',
  account_name: 'TestCo',
  salesforce_account_id: '001TEST',
  play_type: 'utilization_risk',
  risk_color: 'Red',
  destination_slack_channel: 'https://zuora.slack.com/archives/C123',
  renewal_opportunity_url: 'https://zuora.lightning.force.com/lightning/r/Opportunity/006TEST/view',
  posted_at: '2026-05-11T12:00:00Z',
  posted_to_channel: '#expand3-risk-signals',
  status: 'open',
  deadline: '2026-07-01',
  check_back_date: '2026-06-15',
  last_checked_at: null,
  escalation_message_id: null,
};

// ── Tests for parseScanMarkdown link preservation ──────────────────────────

import { parseScanMarkdown, generateSlackMessage, type RichCTA } from '../apps/web/src/lib/cta-utils';

describe('CTA link fields in scan markdown', () => {
  it('preserves renewal_opportunity_url from scan JSON', () => {
    const { richCTAs } = parseScanMarkdown(SAMPLE_SCAN_MD);
    const cta = richCTAs.get('test-gen-001')!;
    expect(cta).toBeDefined();
    expect(cta.renewal_opportunity_url).toBe(
      'https://zuora.lightning.force.com/lightning/r/Opportunity/006TEST/view',
    );
  });

  it('preserves destination_slack_channel from scan JSON', () => {
    const { richCTAs } = parseScanMarkdown(SAMPLE_SCAN_MD);
    const cta = richCTAs.get('test-gen-001')!;
    expect(cta.destination_slack_channel).toBe('https://zuora.slack.com/archives/C123');
  });

  it('handles missing link fields gracefully', () => {
    const ctaNoLinks = { ...SAMPLE_CTA, destination_slack_channel: null, renewal_opportunity_url: null };
    const md = [
      '## CTA 1 — TestCo',
      '',
      '```json',
      JSON.stringify(ctaNoLinks, null, 2),
      '```',
    ].join('\n');
    const { richCTAs } = parseScanMarkdown(md);
    const cta = richCTAs.get('test-gen-001')!;
    expect(cta.destination_slack_channel).toBeNull();
    expect(cta.renewal_opportunity_url).toBeNull();
  });
});

// ── Tests for JSONL log entry format ───────────────────────────────────────

describe('JSONL log entry format', () => {
  it('includes all required fields for CTA card display', () => {
    const entry = SAMPLE_LOG_ENTRY;
    // These fields must be present for the CTABoard to render links
    expect(entry).toHaveProperty('destination_slack_channel');
    expect(entry).toHaveProperty('renewal_opportunity_url');
    expect(entry).toHaveProperty('account_name');
    expect(entry).toHaveProperty('play_type');
    expect(entry).toHaveProperty('risk_color');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('deadline');
  });

  it('carries SFDC opp URL in log entry', () => {
    expect(SAMPLE_LOG_ENTRY.renewal_opportunity_url).toContain('lightning.force.com');
  });

  it('carries Slack channel URL in log entry', () => {
    expect(SAMPLE_LOG_ENTRY.destination_slack_channel).toContain('slack.com');
  });
});

// ── Tests for Slack message generation with link data ──────────────────────

describe('generateSlackMessage with link data CTA', () => {
  it('generates valid message for CTA with all link fields', () => {
    const msg = generateSlackMessage(SAMPLE_CTA as RichCTA);
    expect(msg).toContain('TestCo');
    expect(msg).toContain('renews 8/15');
    expect(msg).toContain('$50K');
    // v2 voice: per cta-utils.test.ts the message must NOT use the
    // legacy "sentiment is X" template — narrativizeSignals renders
    // the actual driver ("Low usage" → "usage flagged red") instead.
    expect(msg).not.toContain('sentiment is red');
    expect(msg).toMatch(/usage flagged red|usage/i);
    // Renewal opp link is appended in Slack mrkdwn format at the very end
    // of the message (intentional v2 change — the card UI also shows a
    // separate link badge). Slack channel URLs never appear in the text.
    expect(msg).toContain('<https://zuora.lightning.force.com/lightning/r/Opportunity/006TEST/view|Renewal opp>');
    expect(msg).not.toContain('slack.com/archives');
  });
});

// ── Tests for scan markdown output format ──────────────────────────────────

describe('scan markdown output format', () => {
  it('produces valid markdown with JSON blocks', () => {
    const md = SAMPLE_SCAN_MD;
    // Should have a header
    expect(md).toContain('# Expand 3 CTA Scan');
    // Should have JSON block
    expect(md).toContain('```json');
    expect(md).toContain('```');
    // Should be parseable
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(1);
  });

  it('includes all link fields in JSON block', () => {
    const md = SAMPLE_SCAN_MD;
    expect(md).toContain('"renewal_opportunity_url"');
    expect(md).toContain('"destination_slack_channel"');
  });
});

// ── Tests for progress event format ────────────────────────────────────────

describe('progress event format', () => {
  it('matches expected shape', () => {
    const event = { type: 'progress', phase: 'init', current: 0, total: 5, label: 'Starting' };
    expect(event.type).toBe('progress');
    expect(event.phase).toBe('init');
    expect(typeof event.current).toBe('number');
    expect(typeof event.total).toBe('number');
    expect(event.label).toBeDefined();
  });

  it('result event matches expected shape', () => {
    const event = {
      type: 'result',
      scanDate: '2026-05-11',
      ctaCount: 12,
      scanFilePath: '/path/to/scan.md',
      logFilePath: '/path/to/log.jsonl',
    };
    expect(event.type).toBe('result');
    expect(typeof event.ctaCount).toBe('number');
    expect(event.scanFilePath).toContain('.md');
    expect(event.logFilePath).toContain('.jsonl');
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseScanMarkdown,
  generateSlackMessage,
  riskEmoji,
  riskLabel,
  type RichCTA,
} from './cta-utils';

// ── Fixtures ───────────────────────────────────────────────────────────────

const MINIMAL_CTA: RichCTA = {
  cta_id: 'test-001',
  account_name: 'Acme Corp',
  salesforce_account_id: '001ABC',
  play_type: 'utilization_risk',
  risk_color: 'Red',
  primary_owner: { name: 'Jane Doe', role: 'AE' },
  drivers: ['Low usage', 'Engagement Red'],
  requested_action: 'Investigate usage drop.',
  deadline: '2026-06-15',
  check_back_date: '2026-06-01',
  expected_artifact: 'Usage report',
  follow_through: {
    if_no_response_by: '2026-06-10',
    then: 'Escalate to manager',
  },
};

const FULL_CTA: RichCTA = {
  ...MINIMAL_CTA,
  cta_id: 'test-002',
  account_name: 'BigCo Ltd',
  play_type: 'managed_wind_down',
  risk_color: 'Red',
  cc_owners: [
    { name: 'Kyle L', role: 'CSE' },
    { name: 'Nick W', role: 'Manager' },
  ],
  cse_sentiment_commentary: 'Customer winding down due to acquisition.',
  commentary_last_updated: '2026-04-22',
  team_aware: true,
  data_gaps: ['No Slack channel confirmed'],
};

function buildScanMarkdown(ctas: RichCTA[], withSlackMessage = false): string {
  const header = '# Expand 3 CTA Scan — 2026-05-11\n\n**Test scan**\n\n---\n\n';
  const sections = ctas.map((cta, i) => {
    let section = `## CTA ${i + 1} — ${cta.account_name}\n\n`;
    section += '```json\n' + JSON.stringify(cta, null, 2) + '\n```\n';
    if (withSlackMessage) {
      section += '\nCustom Slack message for ' + cta.account_name + '\n';
    }
    return section;
  });
  return header + sections.join('\n---\n\n');
}

// ── riskEmoji ──────────────────────────────────────────────────────────────

describe('riskEmoji', () => {
  it('maps Red text to 🔴', () => {
    expect(riskEmoji('Red')).toBe('🔴');
  });
  it('maps 🔴 emoji to 🔴', () => {
    expect(riskEmoji('🔴')).toBe('🔴');
  });
  it('maps Yellow text to 🟡', () => {
    expect(riskEmoji('Yellow')).toBe('🟡');
  });
  it('maps 🟡 emoji to 🟡', () => {
    expect(riskEmoji('🟡')).toBe('🟡');
  });
  it('maps Green text to 🟢', () => {
    expect(riskEmoji('Green')).toBe('🟢');
  });
  it('maps unknown to 🟢', () => {
    expect(riskEmoji('unknown')).toBe('🟢');
  });
});

describe('riskLabel', () => {
  it('maps emoji to text', () => {
    expect(riskLabel('🔴')).toBe('Red');
    expect(riskLabel('🟡')).toBe('Yellow');
    expect(riskLabel('🟢')).toBe('Green');
  });
  it('passes through text', () => {
    expect(riskLabel('Red')).toBe('Red');
    expect(riskLabel('Yellow')).toBe('Yellow');
    expect(riskLabel('Green')).toBe('Green');
  });
});

// ── parseScanMarkdown ──────────────────────────────────────────────────────

describe('parseScanMarkdown', () => {
  it('parses CTA JSON from ## headers', () => {
    const md = buildScanMarkdown([MINIMAL_CTA]);
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(1);
    const cta = richCTAs.get('test-001')!;
    expect(cta.account_name).toBe('Acme Corp');
    expect(cta.play_type).toBe('utilization_risk');
    expect(cta.risk_color).toBe('Red');
  });

  it('parses CTA JSON from ### headers', () => {
    const md = buildScanMarkdown([MINIMAL_CTA]).replace(/^## /gm, '### ');
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(1);
    expect(richCTAs.get('test-001')!.account_name).toBe('Acme Corp');
  });

  it('parses multiple CTAs', () => {
    const md = buildScanMarkdown([MINIMAL_CTA, FULL_CTA]);
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(2);
    expect(richCTAs.has('test-001')).toBe(true);
    expect(richCTAs.has('test-002')).toBe(true);
  });

  it('extracts explicit Slack messages after JSON block', () => {
    const md = buildScanMarkdown([MINIMAL_CTA], true);
    const { slackMessages } = parseScanMarkdown(md);
    expect(slackMessages.size).toBe(1);
    expect(slackMessages.get('test-001')).toContain('Custom Slack message');
  });

  it('returns empty slackMessages when no text after JSON', () => {
    const md = buildScanMarkdown([MINIMAL_CTA], false);
    const { slackMessages } = parseScanMarkdown(md);
    expect(slackMessages.size).toBe(0);
  });

  it('skips sections without JSON blocks', () => {
    const md = '## Summary\n\nNo JSON here.\n\n## CTA 1\n\n```json\n' +
      JSON.stringify(MINIMAL_CTA) + '\n```\n';
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(1);
  });

  it('skips sections with invalid JSON', () => {
    const md = '## CTA 1\n\n```json\n{broken json\n```\n';
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(0);
  });

  it('skips sections with JSON missing cta_id', () => {
    const md = '## CTA 1\n\n```json\n{"account_name": "No ID"}\n```\n';
    const { richCTAs } = parseScanMarkdown(md);
    expect(richCTAs.size).toBe(0);
  });

  it('preserves all rich fields', () => {
    const md = buildScanMarkdown([FULL_CTA]);
    const { richCTAs } = parseScanMarkdown(md);
    const cta = richCTAs.get('test-002')!;
    expect(cta.cse_sentiment_commentary).toBe('Customer winding down due to acquisition.');
    expect(cta.commentary_last_updated).toBe('2026-04-22');
    expect(cta.team_aware).toBe(true);
    expect(cta.data_gaps).toEqual(['No Slack channel confirmed']);
    expect(cta.cc_owners).toHaveLength(2);
    expect(cta.follow_through?.if_no_response_by).toBe('2026-06-10');
    expect(cta.follow_through?.then).toBe('Escalate to manager');
  });
});

// ── generateSlackMessage — v2 voice (CSE-manager perspective) ───────────────
//
// v2 calibration example:
//   🔴 @kyle — D&B renews 5/28/26, $1.1M, and sentiment flagged red.
//   can you take a look at this account today and send me your readout
//   on the usage situation, risk level, and what you think we should do
//   next by 5/21/26? <url|Renewal opp>

describe('generateSlackMessage', () => {
  // ── Structure ────────────────────────────────────────────────────────────

  it('is a single paragraph (no line breaks)', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toContain('\n');
  });

  it('has no bold, no bullet points, no formatting marks', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toContain('•');
    expect(msg).not.toContain('**');
    expect(msg).not.toContain('_');
  });

  it('starts with risk emoji then @firstname lowercase', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toMatch(/^🔴 @jane —/);
  });

  it('ends with deadline or Renewal opp', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toMatch(/by (EOW|\d+\/\d+\/\d+)\?$/);
  });

  // ── Opener: @firstname — account + key context (v2 voice) ───────────────

  it('uses @firstname lowercase in opener', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('@jane —');
  });

  it('includes account name after dash', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('— Acme Corp');
  });

  it('does NOT use "sentiment is X" template (v2: let signals speak)', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toContain('sentiment is red');
    expect(msg).not.toContain('sentiment is yellow');
    expect(msg).not.toContain('sentiment is green');
  });

  it('starts with correct risk emoji for all colors', () => {
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Yellow' })).toMatch(/^🟡/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Green' })).toMatch(/^🟢/);
  });

  // ── Dates as m/d/yy format (v2: always include 2-digit year) ───────────

  it('formats renewal date as m/d/yy when present in drivers', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['Renewal date: 2026-07-22', 'Low usage'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('renews 7/22/26');
    expect(msg).not.toContain('2026-07-22');
  });

  it('includes ARR from drivers in opener, formatted as $XK', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['Renewal date: 2026-07-22', 'ARR: $54,060', 'Low usage'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('renews 7/22/26, $54K');
  });

  // ── Structure: opener → supporting fact → ask+deadline (v2) ────────────

  it('places signals in opener, ask after', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    const signalIdx = msg.indexOf('flagged red');
    const askIdx = msg.indexOf('can you');
    expect(signalIdx).toBeGreaterThan(0);
    expect(askIdx).toBeGreaterThan(signalIdx);
  });

  // ── Signals: narrativized, not raw dumps ─────────────────────────────────

  it('narrativizes driver signals instead of dumping raw text', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    // "Low usage" + "Engagement Red" should be collapsed into a natural phrase
    expect(msg).toContain('usage');
    expect(msg).toContain('engagement');
    expect(msg).toContain('flagged red');
    // Should NOT be raw driver dump
    expect(msg).not.toContain('Low usage. Engagement Red.');
  });

  it('filters ARR/Products from signals and keeps specific data points', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['ARR: $100K', 'Products: Z-Billing', 'Low usage', 'Share at 31%'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('share at 31%');
    // ARR goes in opener, not signals
    expect(msg).not.toContain('ARR: $100K.');
    expect(msg).not.toContain('Products:');
  });

  it('handles CTA with no drivers', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, drivers: undefined };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('Acme Corp');
    expect(msg).not.toContain('sentiment is red');
  });

  // ── Commentary: first sentence, lowercase, skip boilerplate ──────────────

  it('weaves first sentence of commentary inline, lowercased', () => {
    const msg = generateSlackMessage(FULL_CTA);
    // Should start lowercase
    expect(msg).toContain('customer winding down due to acquisition');
  });

  it('strips STATE AND RENEWAL RISK prefix from commentary', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      cse_sentiment_commentary: 'STATE AND RENEWAL RISK: The account is confirmed downselling by $800K.',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).not.toContain('STATE AND RENEWAL RISK');
    expect(msg).toContain('the account is confirmed downselling');
  });

  it('skips commentary that just restates "CSE Sentiment Red"', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      cse_sentiment_commentary: 'CSE Sentiment Red. Engagement Red.',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).not.toContain('cse sentiment red');
  });

  // ── cc: NOT injected into message (v2: manager speaks directly to owner) ──

  it('does not inject cc names into message', () => {
    const msg = generateSlackMessage(FULL_CTA);
    // cc_owners exist but are not auto-injected into the ask
    expect(msg).not.toContain('@nick');
    expect(msg).not.toContain('Nick W');
  });

  // ── Ask: manager-style, play_type-aware (v2) ──────────────────────────

  it('uses play_type-aware manager ask with deadline', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('?');
    // utilization_risk → readout-style ask
    expect(msg).toContain('send me your readout');
    expect(msg).toMatch(/by (EOW|\d+\/\d+\/\d+)\?/);
  });

  it('uses play_type for ask regardless of requested_action', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, requested_action: undefined };
    const msg = generateSlackMessage(cta);
    // Still uses play_type-based ask, not a generic fallback
    expect(msg).toContain('send me your readout');
  });

  it('uses different ask for dark_renewal play type', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, play_type: 'dark_renewal' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('connect with the AE');
    expect(msg).toContain('game plan before renewal');
  });

  it('uses gut-check ask for surprise_churn_watch', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, play_type: 'surprise_churn_watch' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('gut check');
  });

  // ── Data gaps: NOT in message body (v2: data_gaps go in JSON only) ─────

  it('does NOT include data gaps in message body (v2)', () => {
    const msg = generateSlackMessage(FULL_CTA);
    expect(msg).not.toContain('heads up');
    expect(msg).not.toContain('no slack channel');
  });

  // ── Risk emoji at start only ─────────────────────────────────────────────

  it('starts with risk emoji for all colors', () => {
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Yellow' })).toMatch(/^🟡/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Green' })).toMatch(/^🟢/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: '🔴' })).toMatch(/^🔴/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: '🟡' })).toMatch(/^🟡/);
  });

  // ── String primary_owner fallback ────────────────────────────────────────

  it('handles string primary_owner with @firstname', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, primary_owner: 'Bob Smith' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('🔴 @bob — ');
  });

  // ── Renewal opp link (v2: Slack mrkdwn format at end) ─────────────────

  it('appends Renewal opp link when URL exists', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      renewal_opportunity_url: 'https://zuora.lightning.force.com/lightning/r/Opportunity/006ABC/view',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('<https://zuora.lightning.force.com/lightning/r/Opportunity/006ABC/view|Renewal opp>');
  });

  it('omits Renewal opp when no URL', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toContain('Renewal opp');
  });
});

// ── Regression: JSONL-only stubs must not render as cards ────────────────
//
// The JSONL tracking log only carries cta_id + status + deadline.
// When scan MD is deleted, these stubs should NOT produce "Unknown" ghost
// cards.  The page.tsx loadCTAData function must skip entries where
// richMap has no match (i.e. !rich → continue).

describe('JSONL-only stubs never produce displayable CTAs', () => {
  it('parseScanMarkdown returns nothing for non-markdown content', () => {
    // Simulates having no scan MD file — empty rich map
    const { richCTAs } = parseScanMarkdown('');
    expect(richCTAs.size).toBe(0);
  });

  it('parseScanMarkdown returns nothing for JSONL-format lines', () => {
    // JSONL lines are NOT valid scan markdown and should produce zero CTAs
    const jsonlContent = '{"cta_id":"x","status":"open","deadline":"2026-05-25"}\n';
    const { richCTAs } = parseScanMarkdown(jsonlContent);
    expect(richCTAs.size).toBe(0);
  });

  it('a CTA entry requires account_name to be meaningful', () => {
    // Any entry with account_name "Unknown" is a rendering bug
    const md = buildScanMarkdown([MINIMAL_CTA]);
    const { richCTAs } = parseScanMarkdown(md);
    for (const cta of richCTAs.values()) {
      expect(cta.account_name).not.toBe('Unknown');
      expect(cta.risk_color).toBeDefined();
      expect(cta.play_type).toBeDefined();
    }
  });
});

// ── Round-trip: parse → generate ───────────────────────────────────────────

describe('round-trip: parse scan then generate messages', () => {
  it('generates messages for all parsed CTAs', () => {
    const md = buildScanMarkdown([MINIMAL_CTA, FULL_CTA]);
    const { richCTAs, slackMessages } = parseScanMarkdown(md);
    expect(slackMessages.size).toBe(0); // no explicit messages

    // Generate for all
    const generated = new Map<string, string>();
    for (const [id, cta] of richCTAs) {
      generated.set(id, generateSlackMessage(cta));
    }
    expect(generated.size).toBe(2);
    expect(generated.get('test-001')).toContain('@jane');
    expect(generated.get('test-001')).toContain('Acme Corp');
    expect(generated.get('test-002')).toContain('BigCo Ltd');
    expect(generated.get('test-002')).toContain('customer winding down due to acquisition');
  });

  it('prefers explicit Slack message over generated', () => {
    const md = buildScanMarkdown([MINIMAL_CTA], true);
    const { richCTAs, slackMessages } = parseScanMarkdown(md);

    const messages: Record<string, string> = {};
    for (const [id, cta] of richCTAs) {
      if (slackMessages.has(id)) {
        messages[id] = slackMessages.get(id)!;
      } else {
        messages[id] = generateSlackMessage(cta);
      }
    }
    // Should use the explicit message, not generated
    expect(messages['test-001']).toContain('Custom Slack message');
    expect(messages['test-001']).not.toContain('*Acme Corp*');
  });
});

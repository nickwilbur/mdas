import { describe, it, expect } from 'vitest';
import {
  parseScanMarkdown,
  generateSlackMessage,
  resolveMentionTarget,
  formatSlackMention,
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

// ── generateSlackMessage — v3 voice (customer-channel style) ───────────────

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
  });

  it('starts with Slack risk shortcode and full-name @mention', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toMatch(/^:red_circle: @Jane Doe —/);
  });

  it('does not include card deadline in the message', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toMatch(/by (EOW|\d+\/\d+\/\d+)/);
    expect(msg).not.toContain('2026-06-15');
  });

  it('uses full display name in opener', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('@Jane Doe —');
  });

  it('includes account name in the message', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('Acme Corp');
  });

  it('does NOT use "sentiment is X" template', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).not.toContain('sentiment is red');
    expect(msg).not.toContain('sentiment is yellow');
    expect(msg).not.toContain('sentiment is green');
  });

  it('starts with correct risk shortcode for all colors', () => {
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Yellow' })).toMatch(/^:large_yellow_circle:/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Green' })).toMatch(/^:large_green_circle:/);
  });

  it('formats renewal date as m/d/yy when present in drivers', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['Renewal date: 2026-07-22', 'Low usage'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('7/22/26');
    expect(msg).not.toContain('2026-07-22');
  });

  it('includes ARR from drivers when renewal is present', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['Renewal date: 2026-07-22', 'ARR: $54,060', 'Low usage'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('$54K');
    expect(msg).toContain('7/22/26');
  });

  it('uses conversational intent language, not dashboard dumps', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toMatch(/wanted to flag|get ahead|trying to get/i);
    expect(msg).not.toContain('flagged red across');
  });

  it('humanizes driver signals instead of dumping raw text', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toMatch(/usage looks soft/i);
    expect(msg).not.toContain('Low usage. Engagement Red.');
  });

  it('filters ARR/Products meta from the fact sentence', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: ['ARR: $100K', 'Products: Z-Billing', 'Low usage', 'Share at 31%'],
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toMatch(/usage looks soft/i);
    expect(msg).not.toContain('ARR: $100K.');
    expect(msg).not.toContain('Products:');
  });

  it('handles CTA with no drivers', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, drivers: undefined };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('Acme Corp');
    expect(msg).not.toContain('sentiment is red');
  });

  it('weaves commentary with Current State and Renewal Risk label', () => {
    const msg = generateSlackMessage(FULL_CTA);
    expect(msg).toMatch(/customer winding down due to acquisition/i);
  });

  it('strips STATE AND RENEWAL RISK prefix into Current State label', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      drivers: [],
      cse_sentiment_commentary: 'STATE AND RENEWAL RISK: The account is confirmed downselling by $800K.',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('Current State and Renewal Risk:');
    expect(msg).toMatch(/confirmed downselling/i);
  });

  it('skips commentary that just restates "CSE Sentiment Red"', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      cse_sentiment_commentary: 'CSE Sentiment Red. Engagement Red.',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).not.toContain('cse sentiment red');
  });

  it('does not inject cc names into message', () => {
    const msg = generateSlackMessage(FULL_CTA);
    expect(msg).not.toContain('@nick');
    expect(msg).not.toContain('Nick W');
  });

  it('uses play_type-aware conversational ask', () => {
    const msg = generateSlackMessage(MINIMAL_CTA);
    expect(msg).toContain('?');
    expect(msg).toContain('dig into usage');
    expect(msg).not.toMatch(/by (EOW|\d+\/\d+\/\d+)/);
  });

  it('uses play_type for ask regardless of requested_action', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, requested_action: undefined };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('dig into usage');
  });

  it('uses different ask for dark_renewal play type', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, play_type: 'dark_renewal' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('game plan before renewal');
  });

  it('uses gut-check ask for surprise_churn_watch', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, play_type: 'surprise_churn_watch' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('gut check');
  });

  it('does NOT include data gaps in message body', () => {
    const msg = generateSlackMessage(FULL_CTA);
    expect(msg).not.toContain('heads up');
    expect(msg).not.toContain('no slack channel');
  });

  // ── Risk shortcode at start only ───────────────────────────────────────────

  it('starts with risk shortcode for all colors', () => {
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Yellow' })).toMatch(/^:large_yellow_circle:/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: 'Green' })).toMatch(/^:large_green_circle:/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: '🔴' })).toMatch(/^:red_circle:/);
    expect(generateSlackMessage({ ...MINIMAL_CTA, risk_color: '🟡' })).toMatch(/^:large_yellow_circle:/);
  });

  // ── String primary_owner fallback ────────────────────────────────────────

  it('handles string primary_owner with full name mention', () => {
    const cta: RichCTA = { ...MINIMAL_CTA, primary_owner: 'Bob Smith' };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain(':red_circle: @Bob Smith — ');
  });

  // ── No renewal opp link in message body ───────────────────────────────

  it('never appends Renewal opp link even when URL exists', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      renewal_opportunity_url: 'https://zuora.lightning.force.com/lightning/r/Opportunity/006ABC/view',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).not.toContain('Renewal opp');
    expect(msg).not.toContain('lightning.force.com');
  });

  it('never embeds javascript: URLs from tampered renewal_opportunity_url', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      renewal_opportunity_url: 'javascript:alert(1)',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).not.toContain('javascript:');
    expect(msg).not.toContain('Renewal opp');
  });

  it('@mentions CSE when assigned even if primary_owner is AE-shaped legacy data', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      primary_owner: { name: 'Brandon LaTourelle', role: 'AE' },
      ae: { name: 'Brandon LaTourelle', role: 'AE' },
      cse: { name: 'Manoj Raja Krishnan', role: 'CSE' },
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('@Manoj Raja Krishnan —');
    expect(msg).not.toContain('@Brandon');
  });

  it('@mentions AE for digital accounts without a CSE', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      primary_owner: { name: 'Brian Bertges', role: 'AE' },
      ae: { name: 'Brian Bertges', role: 'AE' },
      cse: null,
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('@Brian Bertges —');
  });
});

describe('formatSlackMention', () => {
  it('uses slack_handle when set', () => {
    expect(formatSlackMention({ name: 'Ethan Wookey', slack_handle: 'ethanw' })).toBe('@ethanw');
  });

  it('falls back to full display name', () => {
    expect(formatSlackMention({ name: 'Ethan Wookey', role: 'AE' })).toBe('@Ethan Wookey');
  });
});

describe('resolveMentionTarget', () => {
  it('prefers explicit cse field over ae', () => {
    const target = resolveMentionTarget({
      ...MINIMAL_CTA,
      cse: { name: 'Kyle L', role: 'CSE' },
      ae: { name: 'Jane Doe', role: 'AE' },
    });
    expect(target.owner.name).toBe('Kyle L');
    expect(target.isDigital).toBe(false);
  });

  it('tags AE for digital accounts without CSE', () => {
    const target = resolveMentionTarget({
      ...MINIMAL_CTA,
      primary_owner: { name: 'Ethan Wookey', role: 'AE' },
      ae: { name: 'Ethan Wookey', role: 'AE' },
      cse: null,
    });
    expect(target.owner.name).toBe('Ethan Wookey');
    expect(target.isDigital).toBe(true);
  });
});

describe('Mavenlink-style digital AE CTA', () => {
  it('matches Ethan tagging and Current State commentary voice', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      account_name: 'Mavenlink',
      primary_owner: { name: 'Ethan Wookey', role: 'AE' },
      ae: { name: 'Ethan Wookey', role: 'AE' },
      cse: null,
      play_type: 'dark_account',
      drivers: ['ARR: $100,000', 'No dedicated CSE (digital coverage)'],
      cse_sentiment_commentary:
        '<p>Current State and Renewal Risk: </p><p>Read only contract for one year is confirmed,</p><p>Mavenlink has communicated their decision of not to renew post the current term, they have migrated to Dealhub.</p>',
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain(':red_circle: @Ethan Wookey —');
    expect(msg).toContain("I'm trying to get some visibility on this one on Mavenlink ($100K)");
    expect(msg).toContain('Current State and Renewal Risk:');
    expect(msg).toMatch(/Read only contract for one year is confirmed/i);
    expect(msg).toContain('Can you dig in and send me a read on where things stand?');
  });
});

describe('PropertyVista CSE mention correction', () => {
  const PROPERTY_VISTA_COMMENTARY =
    '<p></p><p color="" style="">State and renewal risk.</p><p color="" style="">No immediate risk. engagement has been low, indicating reduced executive alignment and potential renewal risk.</p><p color="" style="">Account Plan</p><p color="" style="">Re-establish engagement through a structured check-in and executive outreach to realign on goals and value.</p>';

  it('tags @Maha instead of Mahalakshmi Krishnan for SFDC-assigned CSE', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      account_name: 'PropertyVista',
      play_type: 'dark_account',
      primary_owner: { name: 'Mahalakshmi Krishnan', role: 'CSE' },
      cse: { name: 'Mahalakshmi Krishnan', role: 'CSE' },
      ae: { name: 'Ethan Wookey', role: 'AE' },
      drivers: ['ARR: $203,936'],
      cse_sentiment_commentary: PROPERTY_VISTA_COMMENTARY,
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain(':red_circle: @Maha —');
    expect(msg).not.toContain('@Mahalakshmi Krishnan');
  });

  it('parses State and renewal risk commentary without a stray period', () => {
    const cta: RichCTA = {
      ...MINIMAL_CTA,
      account_name: 'PropertyVista',
      play_type: 'dark_account',
      primary_owner: { name: 'Mahalakshmi S', role: 'CSE', slack_handle: 'Maha' },
      cse: { name: 'Mahalakshmi S', role: 'CSE', slack_handle: 'Maha' },
      ae: { name: 'Ethan Wookey', role: 'AE' },
      drivers: ['ARR: $203,936'],
      cse_sentiment_commentary: PROPERTY_VISTA_COMMENTARY,
    };
    const msg = generateSlackMessage(cta);
    expect(msg).toContain('Current State and Renewal Risk:');
    expect(msg).toMatch(/No immediate risk/i);
    expect(msg).not.toMatch(/Renewal Risk: \./);
    expect(msg).not.toContain('Account Plan');
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
    expect(generated.get('test-001')).toContain('@Jane Doe');
    expect(generated.get('test-001')).toContain('Acme Corp');
    expect(generated.get('test-002')).toContain('BigCo Ltd');
    expect(generated.get('test-002')).toMatch(/customer winding down due to acquisition/i);
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

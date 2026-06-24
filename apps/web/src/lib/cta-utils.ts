/**
 * Pure utility functions for CTA scan parsing, Slack message generation,
 * and data merging. No I/O — all functions take data in and return data out.
 */

import { resolveCseSlackOwner } from '@mdas/cta-engine';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RichCTA {
  cta_id: string;
  account_name: string;
  salesforce_account_id: string | null;
  play_type: string;
  risk_color: string;
  primary_owner: { name: string; slack_handle?: string; role: string } | string;
  cc_owners?: { name: string; slack_handle?: string; role: string }[];
  destination_slack_channel?: string | null;
  renewal_opportunity_id?: string | null;
  renewal_opportunity_url?: string | null;
  drivers?: string[];
  requested_action?: string;
  deadline: string;
  check_back_date?: string;
  expected_artifact?: string;
  follow_through?: {
    expected_artifact?: string;
    check_back_date?: string;
    auto_check_query?: string;
    escalation_owner?: string;
    escalation_trigger?: string;
    if_no_response_by?: string;
    then?: string;
  };
  data_gaps?: string[];
  cse_sentiment_commentary?: string | null;
  commentary_last_updated?: string | null;
  team_aware?: boolean;
  ae?: { name: string; role: string } | null;
  cse?: { name: string; role: string } | null;
  situation_read?: string | null;
  point_of_view?: string | null;
  atr_at_risk_usd?: number | null;
  renewal_opportunity_name?: string | null;
}

export interface ParsedScan {
  richCTAs: Map<string, RichCTA>;
  slackMessages: Map<string, string>;
}

// ── Play-type display names ────────────────────────────────────────────────

const PLAY_TYPE_DISPLAY: Record<string, string> = {
  surprise_churn_watch: 'Surprise Churn Watch',
  utilization_risk: 'Utilization Risk',
  dark_renewal: 'Dark Renewal',
  dark_account: 'Dark Account',
  managed_wind_down: 'Managed Wind-Down',
  no_strategic_engagement: 'No Strategic Engagement',
  churn_retro: 'Churn Retro',
  confirmed_churn_retro: 'Confirmed Churn Retro',
  scale_engagement: 'Scale Engagement',
  expertise_risk: 'Expertise Risk',
  engagement_risk: 'Engagement Risk',
  pricing_risk: 'Pricing Risk',
  suite_risk: 'Suite Risk',
  share_risk: 'Share Risk',
  legacy_tech_risk: 'Legacy Tech Risk',
  sentiment_stale: 'Sentiment Stale',
  data_quality_gap: 'Data Quality Gap',
};

// ── Risk-color helpers ─────────────────────────────────────────────────────

export function riskEmoji(color: string): string {
  if (color === '🔴' || color === 'Red') return '🔴';
  if (color === '🟡' || color === 'Yellow') return '🟡';
  return '🟢';
}

export function riskLabel(color: string): string {
  if (color === '🔴' || color === 'Red') return 'Red';
  if (color === '🟡' || color === 'Yellow') return 'Yellow';
  return 'Green';
}

// ── Parse scan markdown ────────────────────────────────────────────────────

export function parseScanMarkdown(content: string): ParsedScan {
  const richCTAs = new Map<string, RichCTA>();
  const slackMessages = new Map<string, string>();

  // Split into CTA sections by ## or ### headers
  const sections = content.split(/^#{2,3} /m).slice(1);

  for (const section of sections) {
    // Extract JSON block
    const jsonMatch = section.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) continue;

    let parsed: RichCTA;
    try {
      parsed = JSON.parse(jsonMatch[1] ?? '{}');
    } catch {
      continue;
    }
    if (!parsed.cta_id) continue;

    richCTAs.set(parsed.cta_id, parsed);

    // Extract Slack message — text after the closing ``` and before the next ---
    const matchIdx = jsonMatch.index ?? 0;
    const afterJson = section.slice(matchIdx + jsonMatch[0].length);
    const slackText = (afterJson.split('---')[0] ?? '')
      .trim()
      .replace(/\n{2,}/g, '\n');
    if (slackText) {
      slackMessages.set(parsed.cta_id, slackText);
    }
  }

  return { richCTAs, slackMessages };
}

// ── Generate Slack message from CTA data (v3 voice) ────────────────────────
//
// Calibrated to Nick's customer-channel posts (#cust-*): intent-first,
// conversational, one specific fact, a human ask — not a dashboard dump.
//
// Reference patterns from live Slack:
//   "I'd like to get ahead of NorthStar for the renewal on 9/30/26..."
//   "I want to make sure we don't have a quiet customer carrying frustration..."
//   "Do you mind touching base? I want to know if this is actually healthy or just quiet."
//
// Rules:
//  - @mention CSE when assigned, else AE (digital) — full display name for Slack
//  - Risk shortcode at start (:red_circle: etc.)
//  - 2–3 sentences, single paragraph
//  - One concrete fact max — skip signal laundry lists
//  - No card due dates in the Slack text (deadlines stay on the board card)

/** Slack shortcode for risk dot at message start. */
export function slackRiskEmoji(color: string): string {
  if (color === '🔴' || color === 'Red') return ':red_circle:';
  if (color === '🟡' || color === 'Yellow') return ':large_yellow_circle:';
  return ':large_green_circle:';
}

/** Format @mention for Slack — prefers slack_handle, else full display name. */
export function formatSlackMention(
  owner: { name: string; slack_handle?: string } | string | null | undefined,
): string {
  if (!owner) return '@team';
  if (typeof owner === 'string') return `@${owner}`;
  const handle = owner.slack_handle?.replace(/^@/, '').trim();
  if (handle) return `@${handle}`;
  return `@${owner.name}`;
}

/** Apply known SFDC→Slack CSE corrections (e.g. Maha vs wrong Mahalakshmi record). */
export function correctCseOwner(
  owner: { name: string; role: string; slack_handle?: string } | null | undefined,
): { name: string; role: string; slack_handle?: string } | null {
  if (!owner?.name || owner.role !== 'CSE') return owner ?? null;
  const corrected = resolveCseSlackOwner(null, owner.name);
  if (!corrected) return owner;
  return {
    ...owner,
    name: corrected.name,
    slack_handle: corrected.slack_handle ?? owner.slack_handle,
  };
}

/** Who gets @mentioned in Slack — CSE when assigned, otherwise AE (digital). */
export function resolveMentionTarget(cta: RichCTA): {
  owner: { name: string; role: string; slack_handle?: string };
  isDigital: boolean;
} {
  const primary =
    typeof cta.primary_owner === 'object' && cta.primary_owner
      ? cta.primary_owner
      : null;

  const cse = correctCseOwner(
    cta.cse ??
      (primary?.role === 'CSE' ? primary : null) ??
      cta.cc_owners?.find((o) => o.role === 'CSE') ??
      null,
  );
  if (cse?.name) {
    return { owner: cse, isDigital: false };
  }

  const ae =
    cta.ae ??
    (primary?.role === 'AE' ? primary : null) ??
    cta.cc_owners?.find((o) => o.role === 'AE') ??
    null;
  if (ae?.name) {
    return { owner: ae, isDigital: true };
  }

  const fallbackName =
    typeof cta.primary_owner === 'string'
      ? cta.primary_owner
      : (primary?.name ?? 'team');
  return { owner: { name: fallbackName, role: 'AE' }, isDigital: true };
}

/** Format ISO date as m/d/yy (v2 voice: always include 2-digit year). */
function shortDate(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const yy = m[1]!.slice(2);
  return `${parseInt(m[2]!, 10)}/${parseInt(m[3]!, 10)}/${yy}`;
}

/** Extract specific metric from drivers (e.g. ARR, utilization %). */
function extractFromDrivers(
  drivers: string[] | undefined,
  pattern: RegExp,
): string | null {
  if (!drivers) return null;
  for (const d of drivers) {
    const m = d.match(pattern);
    if (m) return m[1] ?? m[0];
  }
  return null;
}

/** Extract renewal date from drivers (looks for "Renewal date: YYYY-MM-DD" patterns). */
function extractRenewalDate(drivers: string[] | undefined): string | null {
  if (!drivers) return null;
  for (const d of drivers) {
    const m = d.match(/[Rr]enewal(?:\s+date)?:?\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1]!;
  }
  return null;
}

/** Format a number as $XK or $X.XM like Nick writes ($20K, $1.1M). */
function formatDollars(raw: string): string {
  const num = parseInt(raw.replace(/[,$K]/g, ''), 10);
  if (isNaN(num)) return '$' + raw;
  if (raw.toUpperCase().endsWith('K')) return '$' + raw.replace(/,/g, '');
  if (num >= 1_000_000) {
    const m = num / 1_000_000;
    return '$' + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  if (num >= 1_000) {
    const k = Math.round(num / 1_000);
    return '$' + k + 'K';
  }
  return '$' + num;
}

/** Extract ARR from drivers. */
function extractARR(drivers: string[] | undefined): string | null {
  if (!drivers) return null;
  for (const d of drivers) {
    const m = d.match(/ARR:?\s*\$?([\d,]+(?:K)?)/i);
    if (m) return formatDollars(m[1]!);
  }
  return null;
}

/** Commentary for Slack — keeps Current State and Renewal Risk label when present. */
function commentaryForMessage(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const cleaned = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const prefixMatch = cleaned.match(
    /^(?:(?:Current\s+)?State and [Rr]enewal [Rr]isk|STATE AND RENEWAL RISK|ACTION PLAN):?\s*\.?\s*/i,
  );
  let label = '';
  let body = cleaned;
  if (prefixMatch) {
    label =
      prefixMatch[0]!.toLowerCase().includes('action')
        ? 'ACTION PLAN'
        : 'Current State and Renewal Risk';
    body = cleaned.slice(prefixMatch[0].length).trim();
  }

  body = body.replace(/^[\s.:]+/, '').trim();
  const accountPlanIdx = body.search(/\bAccount Plan\b/i);
  if (accountPlanIdx > 0) body = body.slice(0, accountPlanIdx).trim();

  if (!body || body.length < 12) return null;
  if (/^cse sentiment\s*(is\s*)?(red|yellow|green)/i.test(body)) return null;

  const sentences = body.split(/\.\s+/).filter((s) => s.trim().length > 5);
  let excerpt =
    sentences.length >= 2
      ? `${sentences[0]!.trim()}. ${sentences[1]!.trim()}.`
      : sentences[0]
        ? `${sentences[0]!.trim()}.`
        : body;
  excerpt = excerpt.replace(/\.$/, '').trim();
  if (excerpt.length > 200) excerpt = `${excerpt.slice(0, 197)}…`;
  else excerpt += '…';

  const bodyText = excerpt.charAt(0).toUpperCase() + excerpt.slice(1);
  if (label) return `${label}: ${bodyText}`;
  return bodyText;
}

/** Pick one human-readable fact from drivers — skip meta/ops noise. */
function pickHumanFact(drivers: string[] | undefined): string | null {
  if (!drivers?.length) return null;

  const skip = (d: string) => {
    const dl = d.toLowerCase();
    return (
      dl.startsWith('arr:') ||
      dl.startsWith('atr:') ||
      dl.startsWith('products:') ||
      /^renewal\s*(date)?:/i.test(d) ||
      /commentary last updated/i.test(d) ||
      /no dedicated cse/i.test(d) ||
      /no slack channel/i.test(d) ||
      /^cse sentiment:\s*(red|yellow|green)/i.test(d)
    );
  };

  const patterns: Array<{ re: RegExp; phrase: (m: RegExpMatchArray) => string }> = [
    {
      re: /no workshop logged in the last (\d+) days/i,
      phrase: () => "doesn't look like we've reached out much lately",
    },
    {
      re: /engagio engagement (\d+)\s*min/i,
      phrase: (m) => `engagement has been pretty light (${m[1]} min in the last 30d)`,
    },
    {
      re: /utilization[^.]{0,40}(\d+)%/i,
      phrase: (m) => `utilization looks low (~${m[1]}%)`,
    },
    {
      re: /low usage/i,
      phrase: () => 'usage looks soft',
    },
    {
      re: /cerebro engagement risk/i,
      phrase: () => 'engagement risk is flagged in Cerebro',
    },
    {
      re: /cerebro utilization risk/i,
      phrase: () => 'utilization is tracking below where we want it',
    },
    {
      re: /share[^.]{0,30}(\d+)%/i,
      phrase: (m) => `share is only around ${m[1]}%`,
    },
    {
      re: /no vp\+ meetings/i,
      phrase: () => "we haven't had exec engagement recently",
    },
    {
      re: /sentiment commentary last updated (\d+)d ago/i,
      phrase: (m) => `sentiment notes are ${m[1]} days stale`,
    },
  ];

  for (const d of drivers) {
    if (skip(d)) continue;
    for (const { re, phrase } of patterns) {
      const m = d.match(re);
      if (m) return phrase(m);
    }
  }

  for (const d of drivers) {
    if (skip(d)) continue;
    const colorMatch = d.match(/^(.+?):\s*(Red|Yellow)/i);
    if (colorMatch) {
      const label = colorMatch[1]!
        .trim()
        .toLowerCase()
        .replace(/^cse\s+/, '')
        .replace(/\s+score$/, '');
      if (label === 'sentiment') continue;
      return `${label} is flagged ${colorMatch[2]!.toLowerCase()}`;
    }
  }

  const fallback = drivers.find((d) => !skip(d));
  if (!fallback) return null;
  const trimmed = fallback.replace(/\.$/, '');
  if (trimmed.length > 90) return null;
  const firstWord = trimmed.split(/\s/)[0] ?? '';
  if (firstWord === firstWord.toUpperCase() && firstWord.length <= 4) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function renewalPhrase(
  accountName: string,
  renewalDate: string | null,
  arr: string | null,
  style: 'ahead' | 'inline',
): string {
  if (!renewalDate) {
    return arr ? `${accountName} is at ${arr}` : '';
  }
  const when = shortDate(renewalDate);
  if (style === 'ahead') {
    return arr
      ? `I'd like to get ahead of ${accountName} for renewal on ${when} (${arr})`
      : `I'd like to get ahead of ${accountName} for renewal on ${when}`;
  }
  return arr ? `Renewal is ${when} (${arr})` : `Renewal is ${when}`;
}

function intentLead(playType: string, isDigital: boolean): string {
  switch (playType) {
    case 'dark_account':
      return isDigital
        ? "I'm trying to get some visibility on this one"
        : "I want to make sure we don't have a quiet account carrying risk into the next cycle";
    case 'dark_renewal':
      return "I'd like to get ahead of this renewal before we're in crunch mode";
    case 'utilization_risk':
      return "Wanted to flag usage on this one ahead of renewal";
    case 'engagement_risk':
    case 'no_strategic_engagement':
      return "I'm trying to get some engagement going here";
    case 'surprise_churn_watch':
      return 'I want a quick read on this one before forecast';
    case 'managed_wind_down':
      return 'Want to make sure we have a clean plan on the wind-down';
    case 'sentiment_stale':
      return "I'd like a fresher read on sentiment before we go into forecast";
    case 'data_quality_gap':
      return "We're missing some signal on this account and I want to close the gap";
    default:
      return "I'd like to get ahead of this one";
  }
}

function aeSlackMention(cta: RichCTA): string | null {
  if (!cta.ae?.name) return null;
  const { owner } = resolveMentionTarget(cta);
  if (owner.role === 'AE') return null;
  return formatSlackMention(cta.ae);
}

/** Conversational ask — play-aware; card deadline is shown on the board only. */
function naturalAsk(cta: RichCTA): string {
  const { isDigital } = resolveMentionTarget(cta);
  const ae = aeSlackMention(cta);

  let ask: string;
  switch (cta.play_type) {
    case 'utilization_risk':
      ask = 'Can you dig into usage and let me know what you think we should do';
      break;
    case 'dark_account':
      ask = isDigital
        ? 'Can you dig in and send me a read on where things stand'
        : 'Do you mind touching base? I want to know if this is healthy or just quiet';
      break;
    case 'dark_renewal':
      ask = ae
        ? `Can you sync with ${ae} and make sure we have a clear game plan before renewal`
        : 'Can you connect with the AE and make sure we have a clear game plan before renewal';
      break;
    case 'surprise_churn_watch':
      ask = 'Quick gut check — do you see anything that could create noise for renewal';
      break;
    case 'engagement_risk':
      ask = ae
        ? `Can you reach out and re-introduce yourself as the CSE? Get ${ae} involved if they've been in the thread — I'd like to understand live sentiment`
        : "Can you reach out and let me know what you're hearing";
      break;
    case 'no_strategic_engagement':
      ask = 'Can you get a strategic touchpoint on the calendar this week';
      break;
    case 'managed_wind_down':
      ask = 'Can you make sure the wind-down timeline is documented and we have a clean exit plan';
      break;
    case 'sentiment_stale':
      ask = 'Can you get sentiment updated so we have a clean view going into forecast';
      break;
    case 'confirmed_churn_retro':
    case 'churn_retro':
      ask = 'Can you pull together a quick retro on what happened and what we should have caught earlier';
      break;
    case 'data_quality_gap':
      ask = 'Can you validate the account mapping and get me a read on actual usage and engagement';
      break;
    default:
      ask = 'Can you take a look and let me know your recommendation on next best action';
  }

  return `${ask}?`;
}

/** @deprecated kept for tests that import narrativize behavior indirectly */
function narrativizeSignals(drivers: string[]): string {
  return pickHumanFact(drivers) ?? '';
}

export function generateSlackMessage(cta: RichCTA): string {
  const emoji = slackRiskEmoji(cta.risk_color);
  const { owner: mentionTarget, isDigital } = resolveMentionTarget(cta);
  const mention = formatSlackMention(mentionTarget);

  const renewalDate = extractRenewalDate(cta.drivers);
  const arr = extractARR(cta.drivers);
  const fact = commentaryForMessage(cta.cse_sentiment_commentary) ?? pickHumanFact(cta.drivers);

  const parts: string[] = [];

  const lead = intentLead(cta.play_type, isDigital);
  const renewalCtx = renewalPhrase(cta.account_name, renewalDate, arr, 'ahead');

  let body = `${emoji} ${mention} — `;
  if (renewalCtx && ['dark_renewal', 'utilization_risk', 'sentiment_stale', 'surprise_churn_watch'].includes(cta.play_type)) {
    body += `${renewalCtx}.`;
  } else if (renewalDate) {
    body += `${lead}. ${renewalPhrase(cta.account_name, renewalDate, arr, 'inline')}.`;
  } else {
    body += `${lead} on ${cta.account_name}`;
    if (arr) body += ` (${arr})`;
    body += '.';
  }
  parts.push(body);

  if (fact) {
    parts.push(fact.endsWith('…') || fact.endsWith('.') ? fact : `${fact}.`);
  }

  parts.push(naturalAsk(cta));

  return parts.join(' ');
}

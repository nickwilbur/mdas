/**
 * Pure utility functions for CTA scan parsing, Slack message generation,
 * and data merging. No I/O — all functions take data in and return data out.
 */

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

// ── Generate Slack message from CTA data (v2 voice) ────────────────────────
//
// v2 reasoning-first, CSE-manager perspective. The LLM writes Layer 3
// messages during scans; this function is the programmatic fallback for
// rendering stored CTAs.
//
// Calibration examples:
//
//   🔴 @kyle — D&B renews 5/28/26, $1.1M, and sentiment flagged red.
//   can you take a look at this account today and send me your readout
//   on the usage situation, risk level, and what you think we should do
//   next by 5/21/26?
//
//   🟢 @ethan — RTO Insider renews 7/1/26, $37K. we have zero visibility
//   here — can you dig in and send me a read on where things stand
//   by 6/1/26?
//
// v2 rules:
//  - Primary audience: CSEs (AE only for digital-first, no CSE)
//  - @firstname lowercase (Slack resolves the mention)
//  - Dates as m/d/yy — always include 2-digit year
//  - Two facts max in the body — pick evidence that justifies the ask
//  - Manager-style asks: outcome-oriented, not mechanical
//  - Cc integrated into ask ("can you and @jeanie") only if AE must act
//  - Deadline concrete: "by EOW" or "by m/d/yy"
//  - Renewal opp link at end when URL exists
//  - No bold, no bullet points, no headers, no data_gaps in message
//  - 2–4 sentences target

/** First name only from any owner format. */
function firstName(owner: { name: string } | string | null | undefined): string {
  if (!owner) return '';
  const full = typeof owner === 'object' ? owner.name : owner;
  return full.split(' ')[0] ?? full;
}

/** Format ISO date as m/d/yy (v2 voice: always include 2-digit year). */
function shortDate(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const yy = m[1]!.slice(2);
  return `${parseInt(m[2]!, 10)}/${parseInt(m[3]!, 10)}/${yy}`;
}

/** Format deadline as "by EOW" if ≤5 days, otherwise "by M/D". */
function deadlinePhrase(iso: string): string {
  const diff = Math.ceil(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (diff <= 5 && diff >= 0) return 'by EOW';
  return `by ${shortDate(iso)}`;
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

/** Build the cc line — first names only, exclude Manager role. */
function ccLine(
  ccOwners: { name: string; role: string }[] | undefined,
  primaryName: string,
): string {
  if (!ccOwners || ccOwners.length === 0) return '';
  const names = ccOwners
    .filter((o) => o.role !== 'Manager' && o.name !== primaryName)
    .map((o) => firstName(o).toLowerCase());
  if (names.length === 0) return '';
  return ` cc ${names.join(' ')}`;
}

/** Pick the 2-3 most meaningful signal phrases from drivers. */
function pickSignals(drivers: string[] | undefined): string[] {
  if (!drivers) return [];
  return drivers
    .filter((d) => {
      const dl = d.toLowerCase();
      // Skip meta lines — ARR, Products, renewal date (those go in the opener)
      if (dl.startsWith('arr:') || dl.startsWith('products:')) return false;
      if (/^renewal\s*(date)?:/i.test(d)) return false;
      return true;
    })
    .slice(0, 3);
}

/** Manager-style ask based on play type and context.
 *  Written from Nick's perspective as CSE manager — direct, human,
 *  outcome-oriented. AE-directed only for digital-first accounts. */
function managerAsk(cta: RichCTA): string {
  const isDigital = (typeof cta.primary_owner === 'object'
    ? cta.primary_owner?.role
    : null) === 'AE';

  switch (cta.play_type) {
    case 'utilization_risk':
      return 'can you take a look at this account today and send me your readout on the usage situation, risk level, and what you think we should do next?';
    case 'dark_account':
      return isDigital
        ? 'we have zero visibility here — can you dig in and send me a read on where things stand?'
        : 'we haven\'t had eyes on this one in a while — can you dig in and send me your read on where things stand?';
    case 'dark_renewal':
      return 'can you connect with the AE on this one and make sure we have a clear game plan before renewal?';
    case 'surprise_churn_watch':
      return 'I need a quick gut check from you here — do you see anything that could create noise for renewal?';
    case 'engagement_risk':
      return 'we haven\'t reached out in a while — can you do a quick connect and let me know what you find?';
    case 'managed_wind_down':
      return 'can you make sure the wind-down timeline is documented and we have a clean exit plan?';
    case 'no_strategic_engagement':
      return 'can you prioritize getting a strategic touchpoint on the calendar this week?';
    case 'sentiment_stale':
      return 'can you get the sentiment updated so we have a clean view going into forecast?';
    case 'confirmed_churn_retro':
      return 'can you pull together a quick retro — what happened and what should we have caught earlier?';
    default:
      return 'can you take a look and send me your recommendation on next best action?';
  }
}

/** Narrativize raw driver strings into a human-readable supporting sentence.
 *  Instead of "CSE Sentiment: Red. Engagement: Red. Low Usage." →
 *  "seeing red across sentiment, engagement, and usage." */
function narrativizeSignals(drivers: string[]): string {
  // Collect color-flag signals by actual color and specific-data signals
  const flagsByColor: Record<string, string[]> = { red: [], yellow: [] };
  const specifics: string[] = [];

  for (const d of drivers) {
    const dl = d.toLowerCase();
    // Skip ARR, Products, and renewal date — those are in the opener
    if (dl.startsWith('arr:') || dl.startsWith('products:')) continue;
    if (/^renewal\s*(date)?:/i.test(d)) continue;

    // Detect "X: Red" / "X: Yellow" / "X: Green" pattern
    const colorMatch = d.match(/^(.+?):\s*(Red|Yellow|Green)(?:\s*[,—]|$)/i);
    if (colorMatch) {
      const label = colorMatch[1]!.trim().toLowerCase()
        .replace(/^cse\s+/, '')
        .replace(/\s+score$/, '');
      const color = colorMatch[2]!.toLowerCase();
      // Green signals are not risk flags — skip them
      if (color === 'green') continue;
      (flagsByColor[color] ??= []).push(label);
      continue;
    }

    // "Low Usage" / "Engagement Red" shorthand
    if (dl === 'low usage') { (flagsByColor.red ??= []).push('usage'); continue; }
    if (/engagement\s*(is\s*)?(red|yellow)/i.test(dl)) {
      const ey = dl.includes('yellow') ? 'yellow' : 'red';
      (flagsByColor[ey] ??= []).push('engagement');
      continue;
    }

    // Everything else is a specific data point
    specifics.push(d.replace(/\.$/, ''));
  }

  const out: string[] = [];

  // Collapse flags into natural phrases per color
  for (const [color, flags] of Object.entries(flagsByColor)) {
    if (flags.length === 0) continue;
    if (flags.length >= 3) {
      out.push(`seeing ${color} across ${flags.slice(0, -1).join(', ')}, and ${flags[flags.length - 1]}`);
    } else {
      out.push(`${flags.join(' and ')} flagged ${color}`);
    }
  }

  // Add up to 2 specific data points — lowercase start unless it's an acronym
  for (const s of specifics.slice(0, 2)) {
    const firstWord = s.split(/\s/)[0] ?? '';
    // Don't lowercase acronyms (NA, NPS, ARR, CEO) or proper nouns
    if (firstWord === firstWord.toUpperCase() && firstWord.length <= 4) {
      out.push(s);
    } else {
      out.push(s.charAt(0).toLowerCase() + s.slice(1));
    }
  }

  return out.join('. ');
}

export function generateSlackMessage(cta: RichCTA): string {
  const emoji = riskEmoji(cta.risk_color);
  const primaryObj =
    typeof cta.primary_owner === 'object' && cta.primary_owner
      ? cta.primary_owner
      : null;
  const primaryName = primaryObj?.name ?? (cta.primary_owner as string);
  const ownerFirst = firstName(cta.primary_owner).toLowerCase();

  // Extract structured data from drivers
  const renewalDate = extractRenewalDate(cta.drivers);
  const arr = extractARR(cta.drivers);
  const signals = cta.drivers ? narrativizeSignals(cta.drivers) : '';

  const parts: string[] = [];

  // ── 1. Opener: @owner — account + renewal/ARR + top signal
  let opener = `${emoji} @${ownerFirst} — ${cta.account_name}`;
  if (renewalDate) {
    opener += ` renews ${shortDate(renewalDate)}`;
    if (arr) opener += `, ${arr},`;
  } else if (arr) {
    opener += `, ${arr},`;
  }
  if (signals) {
    opener += (renewalDate || arr ? ' and ' : ' — ') + signals;
  }
  opener += '.';
  parts.push(opener);

  // ── 2. Supporting fact: commentary first sentence (1 sentence max)
  if (cta.cse_sentiment_commentary) {
    const commentary = cta.cse_sentiment_commentary
      .replace(/^STATE AND RENEWAL RISK:\s*/i, '')
      .replace(/^ACTION PLAN:\s*/i, '')
      .trim();
    const firstSentence = commentary.split(/\.\s/)[0]?.trim();
    if (firstSentence && firstSentence.length < 180 && firstSentence.length > 20) {
      const trimmed = firstSentence.replace(/\.$/, '');
      if (!trimmed.toLowerCase().match(/^cse sentiment\s*(is\s*)?(red|yellow|green)/)) {
        parts.push(
          trimmed.charAt(0).toLowerCase() + trimmed.slice(1) + '.',
        );
      }
    }
  }

  // ── 3. Ask + deadline (manager-style, play_type-aware)
  const dl = deadlinePhrase(cta.deadline);
  const ask = managerAsk(cta);
  parts.push(ask.replace(/\?$/, '') + ` ${dl}?`);

  return parts.join(' ');
}

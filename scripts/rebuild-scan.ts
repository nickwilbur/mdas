#!/usr/bin/env tsx
/**
 * Rebuilds the CTA scan file from SFDC report data.
 * Scans ALL accounts (Red, Yellow, Green) for risk signals.
 *
 * Trigger rules:
 *   Red sentiment → CTA (play type based on signals)
 *   Yellow sentiment + renewal within 6 months → surprise_churn_watch
 *   Green sentiment + no CSE + renewal within 12 months → dark_account
 *   Green sentiment + no Slack channel + renewal within 12 months → dark_renewal
 *   Any sentiment + no CSE + no Slack → dark_account (long tail risk)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const PROJECT_ROOT = resolve(__dirname, '..');
const SFDC_DATA_PATH = '/tmp/sfdc_all_accounts.json';
const JSONL_PATH = join(PROJECT_ROOT, 'expand3_cta_log.jsonl');

// Accounts with "Confirmed Full Churn" in SFDC opportunity data.
// These are excluded from CTA generation — no action needed.
const CONFIRMED_CHURN: string[] = [
  'Aryaka Networks',
  'Bird.com',
  'Bitly',
  'BoomTown',
  'CDK Global',
  'Contentsquare',
  'EDF S.A',
  'ForeScout',
  'Kandji',
  'Klipfolio',
  'Lyra Health',
  'Maxwell Health',
  'PNI Maritimes',
  'PubNub',
  'Saison Technology',
  'SimpliSafe',
  'Swing Education',
  'The Wrap News',
  'Traxxall',
  'Tripwire',
  'Turf Tank',
  'Validity',
  'WEHCO Media',
  'ZenQMS',
];

function isConfirmedChurn(accountName: string): boolean {
  const lower = accountName.toLowerCase();
  return CONFIRMED_CHURN.some(c => lower.includes(c.toLowerCase()));
}

interface SFDCAccount {
  name: string;
  sfid: string;
  ae: string;
  cse: string | null;
  slack: string | null;
  arr: number;
  renewal: string;
  sentiment: string;
}

interface CTA {
  cta_id: string;
  account_name: string;
  salesforce_account_id: string;
  play_type: string;
  risk_color: string;
  primary_owner: { name: string; role: string };
  cc_owners: { name: string; role: string }[];
  destination_slack_channel: string | null;
  renewal_opportunity_url: string;
  drivers: string[];
  requested_action: string;
  deadline: string;
  check_back_date: string;
  expected_artifact: string;
  data_gaps: string[];
}

const SCAN_DATE = '2026-05-11';
const SCAN_DATE_MS = new Date(SCAN_DATE).getTime();
const DAY_MS = 1000 * 60 * 60 * 24;

function daysUntilRenewal(renewal: string): number {
  return Math.round((new Date(renewal).getTime() - SCAN_DATE_MS) / DAY_MS);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,()\.\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')[0]; // first word only
}

function playTypeSlug(pt: string): string {
  return pt.replace(/_/g, '-');
}

function computeDeadline(renewal: string): string {
  const days = daysUntilRenewal(renewal);
  if (days <= 30) {
    const d = new Date(renewal);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  if (days <= 90) {
    const d = new Date(SCAN_DATE);
    d.setDate(d.getDate() + 21);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(SCAN_DATE);
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

function checkBackDate(deadline: string): string {
  const d = new Date(deadline);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function getRequestedAction(playType: string): string {
  switch (playType) {
    case 'churn_retro': return 'Conduct churn retro — document reasons and learnings.';
    case 'managed_wind_down': return 'Manage wind-down timeline and ensure clean exit.';
    case 'utilization_risk': return 'Investigate usage patterns and build remediation plan.';
    case 'dark_account': return 'Investigate account status and re-engage.';
    case 'dark_renewal': return 'Re-engage ahead of upcoming renewal.';
    case 'no_strategic_engagement': return 'Establish strategic engagement cadence.';
    case 'surprise_churn_watch': return 'Monitor closely — Yellow sentiment with approaching renewal.';
    default: return 'Review and update SFDC.';
  }
}

/**
 * Classify an account into a play type based on risk signals.
 * Returns null if no CTA is needed.
 */
function classifyAccount(a: SFDCAccount): string | null {
  const days = a.renewal ? daysUntilRenewal(a.renewal) : Infinity;
  const withinYear = days > 0 && days <= 365;
  const within6Mo = days > 0 && days <= 180;
  const within4Q = days > 0 && days <= 365;

  // Red sentiment — always gets a CTA
  if (a.sentiment === 'Red') {
    if (!a.cse && !a.slack) return 'dark_account';
    if (!a.cse) return 'dark_account';
    if (!a.slack && withinYear) return 'dark_renewal';
    return 'utilization_risk'; // default Red play type
  }

  // Yellow sentiment — watch list for approaching renewals
  if (a.sentiment === 'Yellow') {
    if (within6Mo) return 'surprise_churn_watch';
    if (!a.cse && withinYear) return 'dark_account';
    if (!a.slack && withinYear) return 'dark_renewal';
    return null; // Yellow but far out, no CTA needed yet
  }

  // Green sentiment — only flag dark accounts and dark renewals
  if (a.sentiment === 'Green') {
    // No CSE and no Slack = truly dark
    if (!a.cse && !a.slack && withinYear) return 'dark_account';
    // No CSE but has Slack — still a gap
    if (!a.cse && withinYear) return 'dark_account';
    // Has CSE but no Slack channel — dark renewal risk
    if (!a.slack && within6Mo) return 'dark_renewal';
    return null;
  }

  return null;
}

async function main() {
  if (!existsSync(SFDC_DATA_PATH)) {
    console.error('SFDC data not found at', SFDC_DATA_PATH);
    process.exit(1);
  }

  const accounts: SFDCAccount[] = JSON.parse(readFileSync(SFDC_DATA_PATH, 'utf8'));
  console.log(`Scanning ${accounts.length} accounts...`);

  // Preserve existing JSONL entries we want to keep (for status tracking)
  const existingLog = new Map<string, any>();
  if (existsSync(JSONL_PATH)) {
    const lines = readFileSync(JSONL_PATH, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        existingLog.set(entry.cta_id, entry);
      } catch { continue; }
    }
  }

  const ctas: CTA[] = [];
  const stats = { red: 0, yellow: 0, green: 0, skipped: 0, churn: 0 };

  for (const a of accounts) {
    // Skip confirmed churn — no CTA needed
    if (isConfirmedChurn(a.name)) {
      stats.churn++;
      continue;
    }

    const playType = classifyAccount(a);
    if (!playType) {
      stats.skipped++;
      continue;
    }

    if (a.sentiment === 'Red') stats.red++;
    else if (a.sentiment === 'Yellow') stats.yellow++;
    else stats.green++;

    const ctaId = `expand3-${SCAN_DATE}-${slugify(a.name)}-${playTypeSlug(playType)}`;

    const drivers: string[] = [];
    if (a.renewal) drivers.push(`Renewal date: ${a.renewal}`);
    if (a.arr) drivers.push(`ARR: $${Math.round(a.arr).toLocaleString()}`);
    drivers.push(`CSE Sentiment: ${a.sentiment}`);
    if (!a.cse) drivers.push('No dedicated CSE (digital coverage)');
    if (!a.slack) drivers.push('No Slack channel');

    const dataGaps: string[] = [];
    if (!a.cse) dataGaps.push('No CSE assigned (digital coverage)');
    if (!a.slack) dataGaps.push('No Slack channel confirmed');

    const deadline = a.renewal ? computeDeadline(a.renewal) : SCAN_DATE;

    ctas.push({
      cta_id: ctaId,
      account_name: a.name,
      salesforce_account_id: a.sfid,
      play_type: playType,
      risk_color: a.sentiment,
      primary_owner: a.cse
        ? { name: a.cse, role: 'CSE' }
        : { name: a.ae, role: 'AE' },
      cc_owners: a.cse
        ? [{ name: a.ae, role: 'AE' }]
        : [],
      destination_slack_channel: a.slack,
      renewal_opportunity_url: `https://zuora.lightning.force.com/lightning/r/Account/${a.sfid}/view`,
      drivers,
      requested_action: getRequestedAction(playType),
      deadline,
      check_back_date: checkBackDate(deadline),
      expected_artifact: 'SFDC update + Slack thread',
      data_gaps: dataGaps,
    });
  }

  // Sort: Red → Yellow → Green, then by deadline
  ctas.sort((a, b) => {
    const ro: Record<string, number> = { Red: 0, Yellow: 1, Green: 2 };
    const ra = ro[a.risk_color] ?? 3;
    const rb = ro[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  // Write scan markdown
  const header = [
    `# Expand 3 CTA Scan — ${SCAN_DATE}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Total CTAs:** ${ctas.length} (Red: ${stats.red}, Yellow: ${stats.yellow}, Green: ${stats.green}, Churn excluded: ${stats.churn}, Skipped: ${stats.skipped})`,
    `**Script:** \`scripts/rebuild-scan.ts\` (full account scan from SFDC report)`,
    '',
    '---',
    '',
  ].join('\n');

  const sections = ctas.map((cta, i) =>
    `## CTA ${i + 1} — ${cta.account_name}\n\n\`\`\`json\n${JSON.stringify(cta, null, 2)}\n\`\`\`\n`
  );

  const scanPath = join(PROJECT_ROOT, `expand3_cta_scan_${SCAN_DATE}.md`);
  writeFileSync(scanPath, header + sections.join('\n---\n\n'), 'utf-8');

  // Write rich JSONL entries
  const logEntries = ctas.map(cta => {
    // Preserve existing status if we have it
    const existing = existingLog.get(cta.cta_id);
    return JSON.stringify({
      ...cta,
      posted_at: existing?.posted_at ?? `${SCAN_DATE}T22:00:00Z`,
      posted_to_channel: existing?.posted_to_channel ?? '#expand3-risk-signals',
      status: existing?.status ?? 'open',
      last_checked_at: existing?.last_checked_at ?? null,
      escalation_message_id: existing?.escalation_message_id ?? null,
    });
  });

  writeFileSync(JSONL_PATH, logEntries.join('\n') + '\n', 'utf-8');

  console.log(`\n✅ Wrote ${ctas.length} CTAs to ${scanPath}`);
  console.log(`   Red: ${stats.red} | Yellow: ${stats.yellow} | Green: ${stats.green} | Churn excluded: ${stats.churn} | Skipped: ${stats.skipped}`);
  console.log(`✅ Updated ${logEntries.length} rich entries in ${JSONL_PATH}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });

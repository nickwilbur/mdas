#!/usr/bin/env tsx
/**
 * generate-ctas.ts — The single script that controls CTA scan generation.
 *
 * Reads the Expand 3 account universe from SFDC, pulls Cerebro + SFDC +
 * Glean signals via the Glean MCP tools, applies trigger rules, and writes
 * a scan markdown file + JSONL tracking log with a consistent output format.
 *
 * Usage:
 *   npx tsx scripts/generate-ctas.ts              # full scan
 *   npx tsx scripts/generate-ctas.ts --dry-run     # preview only, no file writes
 *   npx tsx scripts/generate-ctas.ts --account "Acme Corp"  # single account
 *
 * Called by:  POST /api/ctas/generate  (web UI "Generate CTAs" button)
 *            /expand3-cta-generator scan (Cascade workflow)
 *
 * Output:
 *   expand3_cta_scan_<YYYY-MM-DD>.md   — human-readable scan document
 *   expand3_cta_log.jsonl              — append-only tracking log
 *   stdout JSON progress events        — consumed by API for progress tracking
 */

import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CTARecord {
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

export interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  label?: string;
}

export interface ScanResult {
  scanDate: string;
  ctaCount: number;
  scanFilePath: string;
  logFilePath: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(__dirname, '..');

function scanFilePath(date: string): string {
  return join(PROJECT_ROOT, `expand3_cta_scan_${date}.md`);
}

function logFilePath(): string {
  return join(PROJECT_ROOT, 'expand3_cta_log.jsonl');
}

// ── Progress reporting ─────────────────────────────────────────────────────

function emitProgress(phase: string, current: number, total: number, label?: string): void {
  const event: ScanProgress = { phase, current, total, ...(label ? { label } : {}) };
  // Write to stdout as JSON line for API consumption
  process.stdout.write(JSON.stringify({ type: 'progress', ...event }) + '\n');
}

// ── JSONL log management ───────────────────────────────────────────────────
//
// The JSONL is the **durable data store**. Each entry carries the full CTA
// record (all display fields) plus tracking metadata.  Scan MD is a
// human-readable export — the JSONL is what the page reads when the MD
// is deleted.

interface LogEntry extends CTARecord {
  posted_at: string;
  posted_to_channel: string;
  status: string;
  last_checked_at: string | null;
  escalation_message_id: string | null;
}

function readExistingLog(): Map<string, LogEntry> {
  const logPath = logFilePath();
  const map = new Map<string, LogEntry>();
  if (!existsSync(logPath)) return map;
  const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      map.set(entry.cta_id, entry);
    } catch {
      continue;
    }
  }
  return map;
}

function appendToLog(cta: CTARecord, scanDate: string): void {
  const entry: LogEntry = {
    // Full CTA record — every field needed to render a card
    ...cta,
    // Tracking metadata
    posted_at: `${scanDate}T${new Date().toISOString().slice(11)}`,
    posted_to_channel: '#expand3-risk-signals',
    status: 'open',
    last_checked_at: null,
    escalation_message_id: null,
  };
  appendFileSync(logFilePath(), JSON.stringify(entry) + '\n');
}

// ── Scan markdown writer ───────────────────────────────────────────────────

function writeScanMarkdown(ctas: CTARecord[], date: string): string {
  const path = scanFilePath(date);
  const header = [
    `# Expand 3 CTA Scan — ${date}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Total CTAs:** ${ctas.length}`,
    `**Script:** \`scripts/generate-ctas.ts\``,
    '',
    '---',
    '',
  ].join('\n');

  const sections = ctas.map((cta, i) => {
    return [
      `## CTA ${i + 1} — ${cta.account_name}`,
      '',
      '```json',
      JSON.stringify(cta, null, 2),
      '```',
      '',
    ].join('\n');
  });

  const content = header + sections.join('\n---\n\n');
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── Main: orchestrate the scan ─────────────────────────────────────────────

// ── MCP client for Glean data pulling ────────────────────────────────────

interface GleanSearchResult {
  title: string;
  url: string;
  snippet?: string;
  updated?: string;
  owner?: string;
  [key: string]: any;
}

async function searchGlean(query: string, app?: string): Promise<GleanSearchResult[]> {
  // This would call the Glean MCP tools
  // For now, return empty array as placeholder
  return [];
}

// ── Data pulling phases ─────────────────────────────────────────────────────

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

async function pullSFDCAccountUniverse(): Promise<SFDCAccount[]> {
  emitProgress('sfdc', 1, 6, 'Pulling SFDC account universe');
  // Pull from SFDC Report 00OPo00000ktI8HMAU via Glean MCP
  // This function is called from the workflow context where MCP tools are available
  // For now, read from the pre-pulled file as fallback
  const sfdcDataPath = '/tmp/sfdc_all_accounts.json';
  if (existsSync(sfdcDataPath)) {
    const data = JSON.parse(readFileSync(sfdcDataPath, 'utf8'));
    return data as SFDCAccount[];
  }

  console.error(`SFDC data not found at ${sfdcDataPath}`);
  return [];
}

async function pullCerebroHealthSignals(accounts: SFDCAccount[]): Promise<Map<string, any>> {
  emitProgress('cerebro', 2, 6, 'Pulling Cerebro health signals');
  const signals = new Map<string, any>();
  // TODO: Pull Cerebro signals via mcp2_search with app: cerebro
  return signals;
}

async function pullSFDCAccountDetails(accounts: SFDCAccount[]): Promise<Map<string, any>> {
  emitProgress('sfdc-details', 3, 6, 'Pulling SFDC account details');
  const details = new Map<string, any>();
  // TODO: Pull CSE Sentiment Commentary, engagement status, last activity via Glean MCP
  return details;
}

async function pullSFOpportunities(accounts: SFDCAccount[]): Promise<Map<string, any>> {
  emitProgress('opportunities', 4, 6, 'Pulling SFDC opportunities');
  const opps = new Map<string, any>();
  // TODO: Pull opportunities via mcp2_search with app: salescloud
  return opps;
}

async function pullGleanActivity(accounts: SFDCAccount[]): Promise<Map<string, any>> {
  emitProgress('glean-activity', 5, 6, 'Pulling Glean activity');
  const activity = new Map<string, any>();
  // TODO: Pull Slack, Gainsight, emails via mcp2_search
  return activity;
}

// ── CTA classification logic ───────────────────────────────────────────────

function classifyAccount(
  account: SFDCAccount,
  cerebroSignals: any,
  sfdcDetails: any,
  opportunity: any,
  gleanActivity: any,
): string | null {
  const scanDate = new Date().toISOString().slice(0, 10);
  const scanDateMs = new Date(scanDate).getTime();
  const daysUntilRenewal = account.renewal
    ? Math.ceil((new Date(account.renewal).getTime() - scanDateMs) / (1000 * 60 * 60 * 24))
    : Infinity;
  const withinYear = daysUntilRenewal > 0 && daysUntilRenewal <= 365;
  const within6Mo = daysUntilRenewal > 0 && daysUntilRenewal <= 180;

  // Red sentiment — always gets a CTA
  if (account.sentiment === 'Red') {
    if (!account.cse && !account.slack) return 'dark_account';
    if (!account.cse) return 'dark_account';
    if (!account.slack && withinYear) return 'dark_renewal';
    return 'utilization_risk'; // default Red play type
  }

  // Yellow sentiment — watch list for approaching renewals
  if (account.sentiment === 'Yellow') {
    if (within6Mo) return 'surprise_churn_watch';
    if (!account.cse && withinYear) return 'dark_account';
    if (!account.slack && withinYear) return 'dark_renewal';
    return null; // Yellow but far out, no CTA needed yet
  }

  // Green sentiment — only flag dark accounts and dark renewals
  if (account.sentiment === 'Green') {
    if (!account.cse && !account.slack && withinYear) return 'dark_account';
    if (!account.cse && withinYear) return 'dark_account';
    if (!account.slack && within6Mo) return 'dark_renewal';
    return null;
  }

  return null;
}

function buildCTA(
  account: SFDCAccount,
  playType: string,
  cerebroSignals: any,
  sfdcDetails: any,
  opportunity: any,
  gleanActivity: any,
  scanDate: string,
): CTARecord {
  const daysUntilRenewal = account.renewal
    ? Math.ceil((new Date(account.renewal).getTime() - new Date(scanDate).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;

  // Compute deadline based on renewal proximity
  let deadline: string;
  if (daysUntilRenewal <= 30) {
    const d = new Date(account.renewal);
    d.setDate(d.getDate() - 7);
    deadline = d.toISOString().slice(0, 10);
  } else if (daysUntilRenewal <= 90) {
    const d = new Date(scanDate);
    d.setDate(d.getDate() + 21);
    deadline = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(scanDate);
    d.setDate(d.getDate() + 90);
    deadline = d.toISOString().slice(0, 10);
  }

  const drivers: string[] = [];
  if (account.renewal) drivers.push(`Renewal date: ${account.renewal}`);
  if (account.arr) drivers.push(`ARR: $${Math.round(account.arr).toLocaleString()}`);
  drivers.push(`CSE Sentiment: ${account.sentiment}`);
  if (!account.cse) drivers.push('No dedicated CSE (digital coverage)');
  if (!account.slack) drivers.push('No Slack channel');

  const data_gaps: string[] = [];
  if (!account.cse) data_gaps.push('No CSE assigned (digital coverage)');
  if (!account.slack) data_gaps.push('No Slack channel confirmed');

  return {
    cta_id: `expand3-${scanDate}-${account.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${playType}`,
    account_name: account.name,
    salesforce_account_id: account.sfid,
    play_type: playType,
    risk_color: account.sentiment,
    primary_owner: account.cse
      ? { name: account.cse, role: 'CSE' }
      : { name: account.ae, role: 'AE' },
    cc_owners: account.cse
      ? [{ name: account.ae, role: 'AE' }]
      : [],
    destination_slack_channel: account.slack,
    renewal_opportunity_url: `https://zuora.lightning.force.com/lightning/r/Account/${account.sfid}/view`,
    drivers,
    requested_action: getRequestedAction(playType),
    deadline,
    check_back_date: new Date(new Date(deadline).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    expected_artifact: 'SFDC update + Slack thread',
    data_gaps: data_gaps,
    cse_sentiment_commentary: sfdcDetails?.cse_sentiment_commentary ?? null,
    commentary_last_updated: sfdcDetails?.commentary_last_updated ?? null,
    team_aware: sfdcDetails?.team_aware ?? false,
    ae: { name: account.ae, role: 'AE' },
    cse: account.cse ? { name: account.cse, role: 'CSE' } : null,
  };
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

export async function runScan(options: {
  dryRun?: boolean;
  accountFilter?: string;
} = {}): Promise<ScanResult> {
  const scanDate = new Date().toISOString().slice(0, 10);
  const existingLog = readExistingLog();

  emitProgress('init', 0, 6, 'Starting CTA scan');

  // ── Phase 1: Pull SFDC account universe ───────────────────────────
  const sfdcAccounts = await pullSFDCAccountUniverse();

  // ── Phase 2: Pull Cerebro health signals ───────────────────────────
  const cerebroSignals = await pullCerebroHealthSignals(sfdcAccounts);

  // ── Phase 3: Pull SFDC account details ──────────────────────────────
  const sfdcDetails = await pullSFDCAccountDetails(sfdcAccounts);

  // ── Phase 4: Pull SFDC opportunities ────────────────────────────────
  const opportunities = await pullSFOpportunities(sfdcAccounts);

  // ── Phase 5: Pull Glean activity ────────────────────────────────────
  const gleanActivity = await pullGleanActivity(sfdcAccounts);

  // ── Phase 6: Classify accounts and build CTAs ─────────────────────
  emitProgress('classify', 6, 6, 'Classifying accounts and building CTAs');

  const allCTAs = new Map<string, CTARecord>();

  for (const account of sfdcAccounts) {
    const playType = classifyAccount(
      account,
      cerebroSignals.get(account.sfid),
      sfdcDetails.get(account.sfid),
      opportunities.get(account.sfid),
      gleanActivity.get(account.sfid),
    );

    if (!playType) continue;

    const cta = buildCTA(
      account,
      playType,
      cerebroSignals.get(account.sfid),
      sfdcDetails.get(account.sfid),
      opportunities.get(account.sfid),
      gleanActivity.get(account.sfid),
      scanDate,
    );

    allCTAs.set(cta.cta_id, cta);
  }

  // ── Apply account filter if specified ─────────────────────────────
  let ctaList = Array.from(allCTAs.values());
  if (options.accountFilter) {
    const filter = options.accountFilter.toLowerCase();
    ctaList = ctaList.filter((c) =>
      c.account_name.toLowerCase().includes(filter),
    );
  }

  // ── Sort — Red first, then deadline ───────────────────────────────
  ctaList.sort((a, b) => {
    const riskOrder: Record<string, number> = {
      '🔴': 0, Red: 0, '🟡': 1, Yellow: 1, '🟢': 2, Green: 2,
    };
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  emitProgress('done', 7, 7, `Scan complete: ${ctaList.length} CTAs`);

  // ── Write outputs ─────────────────────────────────────────────────
  let scanPath = '';
  if (!options.dryRun) {
    scanPath = writeScanMarkdown(ctaList, scanDate);

    // Append new CTAs to log (skip duplicates by cta_id)
    for (const cta of ctaList) {
      if (!existingLog.has(cta.cta_id)) {
        appendToLog(cta, scanDate);
      }
    }
  }

  const result: ScanResult = {
    scanDate,
    ctaCount: ctaList.length,
    scanFilePath: scanPath,
    logFilePath: logFilePath(),
  };

  // Final result event
  process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');

  return result;
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const accountIdx = args.indexOf('--account');
  const accountFilter = accountIdx >= 0 ? args[accountIdx + 1] : undefined;

  runScan({ dryRun, accountFilter })
    .then((result) => {
      if (!dryRun) {
        console.error(`✅ Wrote ${result.ctaCount} CTAs to ${result.scanFilePath}`);
      } else {
        console.error(`🔍 Dry run: ${result.ctaCount} CTAs would be generated`);
      }
    })
    .catch((err) => {
      console.error('❌ Scan failed:', err);
      process.exit(1);
    });
}

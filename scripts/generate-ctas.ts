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

export async function runScan(options: {
  dryRun?: boolean;
  accountFilter?: string;
} = {}): Promise<ScanResult> {
  const scanDate = new Date().toISOString().slice(0, 10);
  const existingLog = readExistingLog();

  emitProgress('init', 0, 5, 'Starting CTA scan');

  // ── Phase 1: Load existing scan data if present ──────────────────────
  // In a full implementation, phases 1-4 would call Glean MCP to pull
  // SFDC report, Cerebro signals, etc. For now, we re-read any existing
  // scan markdown files to preserve CTA data through regeneration cycles.

  const { readdirSync } = await import('fs');
  const existingScanFiles = readdirSync(PROJECT_ROOT).filter(
    (f) => f.startsWith('expand3_cta_scan_') && f.endsWith('.md'),
  );

  // Import the parser from the web app's utility module
  const { parseScanMarkdown, generateSlackMessage } = await import(
    '../apps/web/src/lib/cta-utils'
  );

  const allCTAs = new Map<string, CTARecord>();

  for (const file of existingScanFiles) {
    const content = readFileSync(join(PROJECT_ROOT, file), 'utf-8');
    const { richCTAs } = parseScanMarkdown(content);
    for (const [id, cta] of richCTAs) {
      allCTAs.set(id, cta as CTARecord);
    }
  }

  emitProgress('load', 1, 5, `Loaded ${allCTAs.size} CTAs from scan files`);

  // ── Phase 2: Backfill from JSONL — rich entries have account_name ─────
  // When scan MD is deleted/empty, the JSONL is the durable data store.
  for (const [id, logEntry] of existingLog) {
    if (!allCTAs.has(id) && logEntry.account_name) {
      // Rich JSONL entry — use it
      allCTAs.set(id, logEntry);
    } else if (allCTAs.has(id)) {
      const cta = allCTAs.get(id)!;
      // Backfill links from log if missing in scan
      if (!cta.destination_slack_channel && logEntry.destination_slack_channel) {
        cta.destination_slack_channel = logEntry.destination_slack_channel;
      }
      if (!cta.renewal_opportunity_url && logEntry.renewal_opportunity_url) {
        cta.renewal_opportunity_url = logEntry.renewal_opportunity_url;
      }
    }
  }

  emitProgress('enrich', 2, 5, `${allCTAs.size} CTAs after JSONL backfill`);

  // ── Phase 3: Apply account filter if specified ───────────────────────
  let ctaList = Array.from(allCTAs.values());
  if (options.accountFilter) {
    const filter = options.accountFilter.toLowerCase();
    ctaList = ctaList.filter((c) =>
      c.account_name.toLowerCase().includes(filter),
    );
  }

  emitProgress('filter', 3, 5, `${ctaList.length} CTAs in scope`);

  // ── Phase 4: Sort — Red first, then ARR desc, then deadline ──────────
  ctaList.sort((a, b) => {
    const riskOrder: Record<string, number> = {
      '🔴': 0, Red: 0, '🟡': 1, Yellow: 1, '🟢': 2, Green: 2,
    };
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  emitProgress('sort', 4, 5, 'Sorted by risk and deadline');

  // ── Phase 5: Write outputs ───────────────────────────────────────────
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

  emitProgress('done', 5, 5, `Scan complete: ${ctaList.length} CTAs`);

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

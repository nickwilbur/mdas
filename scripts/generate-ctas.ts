#!/usr/bin/env tsx
/**
 * generate-ctas.ts — Expand 3 CTA scan orchestrator.
 *
 * Reads account context from MDAS snapshots (preferred) or SFDC report
 * JSON fallback, applies @mdas/cta-engine rules, and writes scan output.
 *
 * Usage:
 *   npx tsx scripts/generate-ctas.ts              # full scan
 *   npx tsx scripts/generate-ctas.ts --dry-run     # preview only
 *   npx tsx scripts/generate-ctas.ts --account "Acme Corp"
 */

import {
  writeFileSync,
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { resolve, join } from 'path';
import type { AccountView, CanonicalAccount } from '@mdas/canonical';
import {
  buildAccountView,
  computeRiskScore,
  rankAccountViews,
} from '@mdas/scoring';
import {
  generateCTAsForViews,
  filterExpand3Views,
  mergeConfig,
  mergeCTAUpdate,
  type CTARecord,
  type CTALogEntry,
} from '@mdas/cta-engine';

export type { CTARecord };

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
  suppressedCount: number;
  dataSource: 'snapshot' | 'sfdc-fallback';
}

const PROJECT_ROOT = resolve(__dirname, '..');

function scanFilePath(date: string): string {
  return join(PROJECT_ROOT, `expand3_cta_scan_${date}.md`);
}

function logFilePath(): string {
  return join(PROJECT_ROOT, 'expand3_cta_log.jsonl');
}

function emitProgress(phase: string, current: number, total: number, label?: string): void {
  const event: ScanProgress = { phase, current, total, ...(label ? { label } : {}) };
  process.stdout.write(JSON.stringify({ type: 'progress', ...event }) + '\n');
}

function readExistingLog(): Map<string, CTALogEntry> {
  const logPath = logFilePath();
  const map = new Map<string, CTALogEntry>();
  if (!existsSync(logPath)) return map;
  const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CTALogEntry;
      map.set(entry.cta_id, entry);
    } catch {
      continue;
    }
  }
  return map;
}

function toLogEntry(cta: CTARecord, scanDate: string): CTALogEntry {
  return {
    ...cta,
    posted_at: `${scanDate}T${new Date().toISOString().slice(11)}`,
    posted_to_channel: '#expand3-risk-signals',
    status: 'open',
    last_checked_at: null,
    escalation_message_id: null,
  };
}

function appendToLog(cta: CTARecord, scanDate: string): void {
  appendFileSync(logFilePath(), JSON.stringify(toLogEntry(cta, scanDate)) + '\n');
}

function appendLogUpdate(existing: CTALogEntry, cta: CTARecord, scanDate: string): void {
  appendFileSync(
    logFilePath(),
    JSON.stringify(mergeCTAUpdate(existing, cta, scanDate)) + '\n',
  );
}

/** Full-scan refresh: archive prior log and write only the current scan's CTAs. */
function replaceLog(ctas: CTARecord[], scanDate: string): void {
  const logPath = logFilePath();
  if (existsSync(logPath)) {
    const archivePath = join(PROJECT_ROOT, `expand3_cta_log.archive.${scanDate}.jsonl`);
    renameSync(logPath, archivePath);
  }
  const body = ctas.map((cta) => JSON.stringify(toLogEntry(cta, scanDate))).join('\n');
  writeFileSync(logPath, body ? body + '\n' : '', 'utf-8');
}

/** Remove scan markdown from prior runs so the board shows one generation only. */
function pruneOldScanFiles(keepDate: string): number {
  let removed = 0;
  for (const file of readdirSync(PROJECT_ROOT)) {
    if (!file.startsWith('expand3_cta_scan_') || !file.endsWith('.md')) continue;
    if (file === `expand3_cta_scan_${keepDate}.md`) continue;
    unlinkSync(join(PROJECT_ROOT, file));
    removed++;
  }
  return removed;
}

function writeScanMarkdown(
  ctas: CTARecord[],
  suppressed: Array<{ account_name: string; reason: string }>,
  date: string,
): string {
  const path = scanFilePath(date);
  const header = [
    `# Expand 3 CTA Scan — ${date}`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Total CTAs:** ${ctas.length}`,
    `**Renewal scope:** FY27 + FY28 open renewals`,
    `**CTA gate:** dark, identified risk, or unhealthy only`,
    `**Script:** \`scripts/generate-ctas.ts\` (v3 — @mdas/cta-engine)`,
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

  const suppressedSection =
    suppressed.length > 0
      ? [
          '---',
          '',
          '## Accounts evaluated — no CTA',
          '',
          ...suppressed.slice(0, 100).map((s) => `- **${s.account_name}**: ${s.reason}`),
          '',
        ].join('\n')
      : '';

  const content = header + sections.join('\n---\n\n') + suppressedSection;
  writeFileSync(path, content, 'utf-8');
  return path;
}

interface SFDCReportRow {
  name: string;
  sfid: string;
  ae: string;
  cse: string | null;
  slack: string | null;
  arr: number;
  renewal: string;
  sentiment: string;
}

function loadSFDCReport(): SFDCReportRow[] {
  const sfdcDataPath = '/tmp/sfdc_all_accounts.json';
  if (!existsSync(sfdcDataPath)) return [];
  const data = JSON.parse(readFileSync(sfdcDataPath, 'utf8'));
  return data as SFDCReportRow[];
}

function sfdcRowToAccount(row: SFDCReportRow): CanonicalAccount {
  return {
    accountId: row.sfid,
    salesforceAccountId: row.sfid,
    accountName: row.name,
    zuoraTenantId: null,
    accountOwner: row.ae ? { id: '', name: row.ae } : null,
    assignedCSE: row.cse ? { id: '', name: row.cse } : null,
    csCoverage: row.cse ? 'CSE' : 'Digital',
    franchise: 'Expand 3',
    cseSentiment: (row.sentiment as CanonicalAccount['cseSentiment']) ?? null,
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: null,
    cerebroRiskCategory: null,
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: null,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    cerebroSubMetrics: {},
    allTimeARR: row.arr ?? null,
    activeProductLines: [],
    engagementMinutes30d: null,
    engagementMinutes90d: null,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    salesforceSlackChannelUrl: row.slack,
    sourceLinks: [],
    lastUpdated: new Date().toISOString(),
  };
}

async function loadAccountViews(): Promise<{
  views: AccountView[];
  source: 'snapshot' | 'sfdc-fallback';
}> {
  emitProgress('snapshot', 1, 3, 'Loading MDAS account views');

  try {
    const { latestSuccessfulRun, readAccountViews, readSnapshotAccounts, readSnapshotOpportunities } =
      await import('@mdas/db');

    const run = await latestSuccessfulRun();
    if (run) {
      let views = await readAccountViews(run.id);
      if (views.length > 0) {
        emitProgress('snapshot', 2, 3, `Loaded ${views.length} account views from snapshot`);
        return { views, source: 'snapshot' };
      }

      const accounts = await readSnapshotAccounts(run.id);
      const opps = await readSnapshotOpportunities(run.id);
      if (accounts.length > 0) {
        views = accounts.map((a) =>
          buildAccountView(
            a,
            opps.filter((o) => o.accountId === a.accountId),
          ),
        );
        emitProgress('snapshot', 2, 3, `Built ${views.length} views from snapshot accounts`);
        return { views: rankAccountViews(views), source: 'snapshot' };
      }
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: 'cta.snapshot.unavailable',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  emitProgress('sfdc-fallback', 2, 3, 'Falling back to SFDC report JSON');
  const rows = loadSFDCReport();
  if (rows.length === 0) {
    console.error('No snapshot or /tmp/sfdc_all_accounts.json available');
    return { views: [], source: 'sfdc-fallback' };
  }

  const views = rows.map((row) => {
    const account = sfdcRowToAccount(row);
    const opps = row.renewal
      ? [
          {
            opportunityId: `renewal-${row.sfid}`,
            opportunityName: `${row.name} Renewal`,
            accountId: row.sfid,
            type: 'Renewal',
            stageName: 'Unknown',
            stageNum: null,
            closeDate: row.renewal,
            closeQuarter: '',
            fiscalYear: new Date(row.renewal).getFullYear(),
            acv: row.arr,
            availableToRenewUSD: row.arr,
            forecastMostLikely: null,
            forecastMostLikelyOverride: null,
            mostLikelyConfidence: null,
            forecastHedgeUSD: null,
            acvDelta: null,
            knownChurnUSD: null,
            productLine: null,
            flmNotes: null,
            slmNotes: null,
            scNextSteps: null,
            salesEngineer: null,
            fullChurnNotificationToOwnerDate: null,
            fullChurnFinalEmailSentDate: null,
            churnDownsellReason: null,
            sourceLinks: [],
            lastUpdated: new Date().toISOString(),
          },
        ]
      : [];
    const view = buildAccountView(account, opps);
    const riskScore = computeRiskScore({
      account,
      opportunities: opps,
      now: Date.now(),
    });
    return { ...view, riskScore };
  });

  return { views: rankAccountViews(views), source: 'sfdc-fallback' };
}

function filterToExpand3Universe(
  views: AccountView[],
  reportRows: SFDCReportRow[],
  scopeOpts: { now: number; renewalFiscalYears: number[] },
): AccountView[] {
  const ids = new Set(reportRows.map((r) => r.sfid));
  const names = new Set(reportRows.map((r) => r.name.toLowerCase()));
  return filterExpand3Views(views, {
    reportAccountIds: ids,
    reportAccountNames: names,
    ...scopeOpts,
  });
}

function scopeViewsForCta(
  views: AccountView[],
  reportRows: SFDCReportRow[],
): AccountView[] {
  const config = mergeConfig();
  const scopeOpts = {
    now: Date.now(),
    renewalFiscalYears: config.renewalFiscalYears,
  };
  if (reportRows.length > 0) {
    return filterToExpand3Universe(views, reportRows, scopeOpts);
  }
  return filterExpand3Views(views, scopeOpts);
}

export async function runScan(options: {
  dryRun?: boolean;
  accountFilter?: string;
  /** Replace all persisted CTAs (default true for full scans). */
  refresh?: boolean;
} = {}): Promise<ScanResult> {
  const scanDate = new Date().toISOString().slice(0, 10);
  const isFullScan = !options.accountFilter;
  const refresh = options.refresh ?? isFullScan;
  const existingLog = refresh ? new Map<string, CTALogEntry>() : readExistingLog();

  emitProgress('init', 0, 3, 'Starting CTA scan');

  const { views: allViews, source } = await loadAccountViews();
  const reportRows = loadSFDCReport();
  const views = scopeViewsForCta(allViews, reportRows);

  emitProgress('classify', 3, 3, `Evaluating ${views.length} accounts`);

  const { ctas, suppressed, skipped } = generateCTAsForViews(views, {
    scanDate,
    accountFilter: options.accountFilter,
    existingLog,
    skipDedup: refresh,
  });

  console.info(
    JSON.stringify({
      msg: 'cta.scan.complete',
      service: 'generate-ctas',
      scanDate,
      ctaCount: ctas.length,
      suppressedCount: suppressed.length,
      skippedDedup: skipped,
      dataSource: source,
    }),
  );

  let scanPath = '';
  let prunedScans = 0;
  if (!options.dryRun) {
    scanPath = writeScanMarkdown(ctas, suppressed, scanDate);

    if (refresh && isFullScan) {
      prunedScans = pruneOldScanFiles(scanDate);
      replaceLog(ctas, scanDate);
    } else {
      for (const cta of ctas) {
        const existing = existingLog.get(cta.cta_id);
        if (!existing) {
          appendToLog(cta, scanDate);
        } else {
          appendLogUpdate(existing, cta, scanDate);
        }
      }
    }
  }

  if (prunedScans > 0) {
    console.info(
      JSON.stringify({
        msg: 'cta.scan.pruned',
        removedScanFiles: prunedScans,
      }),
    );
  }

  const result: ScanResult = {
    scanDate,
    ctaCount: ctas.length,
    scanFilePath: scanPath,
    logFilePath: logFilePath(),
    suppressedCount: suppressed.length,
    dataSource: source,
  };

  process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
  return result;
}

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

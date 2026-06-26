#!/usr/bin/env tsx
/**
 * Manager triage brief from expand3_cta_log.jsonl — top open CTAs by priority.
 *
 * Usage:
 *   npx tsx scripts/cta-open-triage.ts
 *   npx tsx scripts/cta-open-triage.ts --limit 10 --format markdown
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface CtaLogRow {
  cta_id: string;
  account_name: string;
  play_type: string;
  risk_color: string;
  priority_score: number;
  atr_at_risk_usd?: number;
  status: string;
  team_aware?: boolean;
  primary_owner?: { name: string; role: string };
  renewal_opportunity_url?: string;
  deadline?: string;
  drivers?: string[];
}

const LOG_PATH = resolve(process.cwd(), 'expand3_cta_log.jsonl');

function parseArgs(): { limit: number; format: 'table' | 'markdown' } {
  const args = process.argv.slice(2);
  let limit = 10;
  let format: 'table' | 'markdown' = 'markdown';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = Number(args[++i]);
    if (args[i] === '--format' && args[i + 1]) format = args[++i] as 'table' | 'markdown';
  }
  return { limit, format };
}

function loadOpenCtas(): CtaLogRow[] {
  const raw = readFileSync(LOG_PATH, 'utf8');
  const rows: CtaLogRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as CtaLogRow;
    if (row.status === 'open') rows.push(row);
  }
  return rows.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
}

function fmtUsd(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function main(): void {
  const { limit, format } = parseArgs();
  const open = loadOpenCtas();
  const top = open.slice(0, limit);
  const openAtr = open.reduce((s, r) => s + (r.atr_at_risk_usd ?? 0), 0);

  if (format === 'markdown') {
    console.log(`# Expand 3 CTA Open Triage — ${new Date().toISOString().slice(0, 10)}`);
    console.log('');
    console.log(`- **Open CTAs:** ${open.length}`);
    console.log(`- **Open ATR at risk:** ${fmtUsd(openAtr)}`);
    console.log(`- **Team aware:** ${open.filter((r) => r.team_aware).length}`);
    console.log('');
    console.log('| Rank | Account | Play | Risk | ATR at risk | Owner | Deadline | Team aware |');
    console.log('| ---- | ------- | ---- | ---- | ----------- | ----- | -------- | ---------- |');
    top.forEach((r, i) => {
      const owner = r.primary_owner ? `${r.primary_owner.name} (${r.primary_owner.role})` : '—';
      console.log(
        `| ${i + 1} | ${r.account_name} | ${r.play_type} | ${r.risk_color} | ${fmtUsd(r.atr_at_risk_usd)} | ${owner} | ${r.deadline ?? '—'} | ${r.team_aware ? 'yes' : 'no'} |`,
      );
    });
    console.log('');
    console.log('## Suggested manager actions');
    console.log('');
    for (const r of top.slice(0, 5)) {
      const driver = r.drivers?.[0] ?? 'Review drivers in MDAS';
      console.log(`- **${r.account_name}** — ${driver}; mark \`team_aware\` when posted in channel.`);
    }
    return;
  }

  console.table(
    top.map((r, i) => ({
      rank: i + 1,
      account: r.account_name,
      play: r.play_type,
      risk: r.risk_color,
      atr: r.atr_at_risk_usd,
      owner: r.primary_owner?.name,
      deadline: r.deadline,
      team_aware: r.team_aware ?? false,
    })),
  );
}

main();

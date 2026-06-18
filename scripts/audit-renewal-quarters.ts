/**
 * Audit renewal metrics by fiscal quarter — run: npx tsx scripts/audit-renewal-quarters.ts
 */
import { latestSuccessfulRun, readAccountViews } from '../packages/db/src/index.js';
import {
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  currentFiscalQuarter,
  previousFiscalQuarterKey,
} from '../apps/web/src/lib/fiscal.js';
import {
  buildRenewalMetrics,
  buildRenewalQuarterTrend,
  isRenewalLike,
  isClosedOpportunity,
} from '../packages/renewal-metrics/src/index.js';

async function main() {
  const run = await latestSuccessfulRun();
  if (!run) {
    console.log('No refresh run');
    return;
  }
  const views = (await readAccountViews(run.id)).filter(
    (v) => v.account.franchise === 'Expand 3',
  );
  const qfn = (iso: string | null | undefined) => fiscalQuarterFromDate(iso)?.key ?? null;

  const byQ = new Map<
    string,
    { opps: number; atr: number; closed: number; open: number; accounts: Set<string> }
  >();
  for (const v of views) {
    for (const o of v.opportunities) {
      if (!isRenewalLike(o)) continue;
      const k = qfn(o.closeDate);
      if (!k) continue;
      const cur = byQ.get(k) ?? {
        opps: 0,
        atr: 0,
        closed: 0,
        open: 0,
        accounts: new Set<string>(),
      };
      cur.opps++;
      cur.atr += o.availableToRenewUSD ?? 0;
      if (isClosedOpportunity(o)) cur.closed++;
      else cur.open++;
      cur.accounts.add(v.account.accountId);
      byQ.set(k, cur);
    }
  }

  console.log('=== Raw renewal opps by close quarter ===');
  for (const k of [...byQ.keys()].sort()) {
    const c = byQ.get(k)!;
    console.log(
      `${k} (${fiscalQuarterLabel(k)}): ${c.opps} opps, ${c.accounts.size} accts, ATR $${Math.round(c.atr).toLocaleString()}, closed ${c.closed}, open ${c.open}`,
    );
  }

  const cur = currentFiscalQuarter().key;
  const prev = previousFiscalQuarterKey(cur)!;
  console.log(`\nCurrent: ${cur}, Prior: ${prev}`);

  for (const qk of [cur, prev]) {
    const m = buildRenewalMetrics({
      views,
      quarterKeys: new Set([qk]),
      quarterKeyFn: qfn,
    });
    console.log(
      `\nMetrics ${fiscalQuarterLabel(qk)} (asOf=today): ATR $${Math.round(m.atrUpForRenewalUSD).toLocaleString()}, renewed $${Math.round(m.renewedRevenueUSD).toLocaleString()}, GRR ${((m.grossRevenueRetentionPct ?? 0) * 100).toFixed(1)}%`,
    );
    console.log(
      `  outcomes: churn ${m.outcomeCounts.full_churn}, downsell ${m.outcomeCounts.downsell}, flat ${m.outcomeCounts.flat}, expanded ${m.outcomeCounts.expanded}, pending ${m.outcomeCounts.pending}, pushed ${m.outcomeCounts.pushed}`,
    );
  }

  // FY27 Q1 deep dive
  console.log('\n=== FY27 Q1 closed renewal deep dive ===');
  const qk = '2027-Q1';
  const { deriveRenewedRevenueUSD, classifyRenewalOutcome, closedOpportunityOutcome } =
    await import('../packages/renewal-metrics/src/index.js');
  const samples: Array<Record<string, unknown>> = [];
  for (const v of views) {
    for (const o of v.opportunities) {
      if (!isRenewalLike(o)) continue;
      if (qfn(o.closeDate) !== qk) continue;
      const atr = o.availableToRenewUSD ?? 0;
      samples.push({
        name: v.account.accountName.slice(0, 24),
        atr,
        renewed: deriveRenewedRevenueUSD(o, v),
        outcome: classifyRenewalOutcome(o, v, new Date().toISOString()),
        acv: o.acv,
        acvDelta: o.acvDelta,
        ml: o.forecastMostLikely,
        closed: closedOpportunityOutcome(o),
        stage: o.stageName?.slice(0, 35),
      });
    }
  }
  samples.sort((a, b) => (b.atr as number) - (a.atr as number));
  for (const s of samples.slice(0, 8)) console.log(s);
  console.log(
    'Totals:',
    samples.length,
    'ATR',
    samples.reduce((s, x) => s + (x.atr as number), 0),
    'renewed',
    samples.reduce((s, x) => s + (x.renewed as number), 0),
  );

  console.log('\n=== Full trend FY26 Q1 → FY27 Q2 (quarter-end asOf) ===');
  const { buildRenewalQuarterTrend, enumerateFiscalQuarterKeys } =
    await import('../packages/renewal-metrics/src/index.js');
  const trend = buildRenewalQuarterTrend(
    views,
    enumerateFiscalQuarterKeys('2026-Q1', '2027-Q2'),
    qfn,
    fiscalQuarterLabel,
  );
  for (const t of trend) {
    console.log(
      `${t.quarterLabel}: ATR $${Math.round(t.atrUpForRenewalUSD / 1e6 * 10) / 10}M, renewed $${Math.round(t.renewedRevenueUSD / 1e6 * 10) / 10}M, GRR ${((t.grossRevenueRetentionPct ?? 0) * 100).toFixed(1)}%, accts ${t.accountsUpForRenewal}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

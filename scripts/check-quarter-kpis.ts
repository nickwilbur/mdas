#!/usr/bin/env tsx
import { latestSuccessfulRun, readAccountViews } from '@mdas/db';
import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import {
  computeQuarterKpis,
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  fiscalQuarterStart,
} from '@mdas/forecast-generator';

function isRenewalLike(opp: CanonicalOpportunity): boolean {
  return String(opp.type ?? '').toLowerCase().includes('renewal');
}

function hasDownForecastSignal(opp: CanonicalOpportunity): boolean {
  if ((opp.knownChurnUSD ?? 0) > 0) return true;
  if (!isRenewalLike(opp)) return false;
  if (opp.forecastMostLikelyOverride != null && opp.forecastMostLikelyOverride < 0) {
    return true;
  }
  if (opp.forecastMostLikely != null && opp.forecastMostLikely < 0) return true;
  if (opp.acvDelta != null && opp.acvDelta < 0) return true;
  return false;
}

function flashUSD(opp: CanonicalOpportunity): number {
  const known = opp.knownChurnUSD ?? 0;
  if (known > 0) return -known;
  if (!isRenewalLike(opp)) return 0;
  if (opp.forecastMostLikelyOverride != null) {
    return opp.forecastMostLikelyOverride < 0 ? opp.forecastMostLikelyOverride : 0;
  }
  const ml = opp.forecastMostLikely;
  if (ml != null && ml < 0) return ml;
  const ad = opp.acvDelta;
  if (ad != null && ad < 0) return ad;
  return 0;
}

async function main(): Promise<void> {
  const asOfDate = process.argv[2] ?? '2026-06-25';
  const run = await latestSuccessfulRun();
  if (!run) throw new Error('no successful refresh');
  const views = (await readAccountViews(run.id)).filter(
    (v) => v.account.franchise === 'Expand 3',
  );

  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  const nextFq = fiscalQuarterFromDate(d.toISOString());
  if (!nextFq) throw new Error('no next quarter');

  const rows: { view: AccountView; opp: CanonicalOpportunity }[] = [];
  for (const v of views) {
    for (const o of v.opportunities) {
      const fq = fiscalQuarterFromDate(o.closeDate);
      if (fq?.key === nextFq.key) rows.push({ view: v, opp: o });
    }
  }

  const churnRows = rows.filter(
    (r) => isRenewalLike(r.opp) && hasDownForecastSignal(r.opp),
  );
  const flash = churnRows.reduce((s, r) => s + flashUSD(r.opp), 0);
  const atr = churnRows.reduce((s, r) => s + (r.opp.availableToRenewUSD ?? 0), 0);

  console.log(`FY27 Q3 churn grid (${churnRows.length} opps)`);
  console.log(`  Flash sum:  ${flash.toLocaleString()}`);
  console.log(`  ATR sum:    ${atr.toLocaleString()}`);
  console.log(`  computeQuarterKpis next.flash: ${computeQuarterKpis(views, asOfDate, 'next', null).flashUSD.toLocaleString()}`);
  console.log('');
  console.log('Top flash contributors:');
  const ranked = [...churnRows]
    .map((r) => ({
      name: r.view.account.accountName,
      close: r.opp.closeDate,
      flash: flashUSD(r.opp),
      atr: r.opp.availableToRenewUSD ?? 0,
      ml: r.opp.forecastMostLikely,
      mlOvr: r.opp.forecastMostLikelyOverride,
      stage: r.opp.stageName,
    }))
    .sort((a, b) => a.flash - b.flash)
    .slice(0, 15);
  for (const r of ranked) {
    console.log(
      `  ${r.flash.toLocaleString().padStart(12)} | ATR ${r.atr.toLocaleString().padStart(10)} | ${r.name} | ${r.close} | ${r.stage}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

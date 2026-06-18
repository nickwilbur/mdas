import { getDashboardData } from '@/lib/read-model';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { RefreshButton } from '@/components/RefreshButton';
import { RelativeTime } from '@/components/ui';
import {
  currentFiscalQuarter,
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  fiscalQuarterStartIso,
  fiscalQuartersForAccount,
  parseQuartersParam,
  previousFiscalQuarterKey,
} from '@/lib/fiscal';
import { computeQuarterKpis } from '@mdas/forecast-generator';
import {
  buildAtRiskPipeline,
  buildRenewalAccountRows,
  buildRenewalMetrics,
  buildRenewalOppRows,
  buildRenewalQuarterTrend,
  asOfDateForQuarter,
  enumerateFiscalQuarterKeys,
  type RenewalAccountRow,
  type RenewalOutcome,
} from '@mdas/renewal-metrics';
import { RenewalDashboardClient } from './RenewalDashboardClient';

export const dynamic = 'force-dynamic';

function attentionAccounts(accounts: RenewalAccountRow[]): RenewalAccountRow[] {
  const priority: RenewalOutcome[] = ['full_churn', 'pushed', 'downsell', 'pending'];
  return accounts
    .filter((a) => priority.includes(a.outcome))
    .sort((a, b) => {
      const pa = priority.indexOf(a.outcome);
      const pb = priority.indexOf(b.outcome);
      if (pa !== pb) return pa - pb;
      return b.atrUSD - a.atrUSD;
    });
}

/** ATR on all open renewals closing within horizon (not just at-risk flagged). */
function upcomingAtr(
  views: Parameters<typeof buildRenewalOppRows>[0],
  horizonDays: 30 | 60 | 90,
  asOfDate: string,
): RenewalAccountRow[] {
  const today = Date.parse(asOfDate.slice(0, 10));
  const rows = buildRenewalOppRows(views, null, () => null, asOfDate).filter((r) => {
    if (r.outcome !== 'pending' && r.outcome !== 'pushed') return false;
    if (!r.closeDate) return false;
    const close = Date.parse(r.closeDate);
    const days = (close - today) / 86_400_000;
    if (horizonDays === 30) return days >= 0 && days <= 30;
    if (horizonDays === 60) return days > 30 && days <= 60;
    return days > 60 && days <= 90;
  });
  return buildRenewalAccountRows(rows, asOfDate);
}

export default async function RenewalsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const asOfDate = new Date().toISOString();
  const { views: allViews, refreshId, startedAt } = await getDashboardData();

  if (!refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Renewal dashboard</h1>
        <p className="text-gray-700">
          No data yet. Run <code>make seed</code> or click Refresh.
        </p>
        <RefreshButton />
      </div>
    );
  }

  const selectedQuarters = parseQuartersParam(quarters);
  const availableQuarterKeys = Array.from(
    new Set(allViews.flatMap((v) => fiscalQuartersForAccount(v))),
  );

  // Default to current fiscal quarter when no filter — clearer executive view.
  const effectiveQuarters =
    selectedQuarters ??
    new Set([currentFiscalQuarter().key]);

  const quarterKeyFn = (iso: string | null | undefined) =>
    fiscalQuarterFromDate(iso)?.key ?? null;

  const primaryQuarterKey =
    effectiveQuarters.size === 1 ? [...effectiveQuarters][0]! : currentFiscalQuarter().key;
  const metricsAsOf = asOfDateForQuarter(primaryQuarterKey, asOfDate);

  let priorQuarterKeys: Set<string> | null = null;
  if (effectiveQuarters.size === 1) {
    const prev = previousFiscalQuarterKey(primaryQuarterKey);
    if (prev) priorQuarterKeys = new Set([prev]);
  }

  const metrics = buildRenewalMetrics({
    views: allViews,
    quarterKeys: effectiveQuarters,
    quarterKeyFn,
    priorQuarterKeys,
    asOfDate: metricsAsOf,
  });

  const oppRows = buildRenewalOppRows(allViews, effectiveQuarters, quarterKeyFn, metricsAsOf);
  const accounts = buildRenewalAccountRows(oppRows, metricsAsOf);

  // Full FY26 → current quarter trend (all historical data in snapshot).
  const trendEndKey = primaryQuarterKey;
  const trendKeys = enumerateFiscalQuarterKeys('2026-Q1', trendEndKey);

  const trend = buildRenewalQuarterTrend(
    allViews,
    trendKeys,
    quarterKeyFn,
    fiscalQuarterLabel,
    asOfDate,
  );

  const quarterLabel =
    effectiveQuarters.size === 1
      ? fiscalQuarterLabel([...effectiveQuarters][0]!)
      : [...effectiveQuarters].map(fiscalQuarterLabel).join(', ');

  const selectedQuarterKey =
    effectiveQuarters.size === 1 ? [...effectiveQuarters][0]! : null;

  const quarterFlashUSD =
    selectedQuarterKey != null
      ? computeQuarterKpis(
          allViews,
          fiscalQuarterStartIso(selectedQuarterKey),
          'current',
          null,
        ).flashUSD
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Renewal dashboard</h1>
          <p className="text-xs text-gray-500">
            Expand 3 CSE renewal health · Last refresh: <RelativeTime iso={startedAt} />
          </p>
        </div>
        <RefreshButton />
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />

      <RenewalDashboardClient
        metrics={metrics}
        trend={trend}
        attentionAccounts={attentionAccounts(accounts)}
        atRisk30={upcomingAtr(allViews, 30, asOfDate)}
        atRisk60={upcomingAtr(allViews, 60, asOfDate)}
        atRisk90={upcomingAtr(allViews, 90, asOfDate)}
        quarterLabel={quarterLabel}
        selectedQuarterKey={selectedQuarterKey}
        quarterFlashUSD={quarterFlashUSD}
      />
    </div>
  );
}

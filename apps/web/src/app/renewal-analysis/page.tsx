import { getDashboardData } from '@/lib/read-model';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { RefreshButton } from '@/components/RefreshButton';
import { RelativeTime } from '@/components/ui';
import {
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  fiscalQuartersForAccount,
  parseQuartersParam,
  previousFiscalQuarterKey,
} from '@/lib/fiscal';
import {
  buildAtRiskPipeline,
  buildKnownChurnOppRows,
  buildRenewalAccountRows,
  buildRenewalMetrics,
  buildRenewalOppRows,
  asOfDateForQuarter,
} from '@mdas/renewal-metrics';
import { RenewalAnalysisClient } from './RenewalAnalysisClient';

export const dynamic = 'force-dynamic';

export default async function RenewalAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string; outcome?: string; knownChurn?: string }>;
}) {
  const { quarters, outcome, knownChurn } = await searchParams;
  const asOfDate = new Date().toISOString();
  const { views: allViews, refreshId, startedAt } = await getDashboardData();

  if (!refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Renewal analysis</h1>
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

  const quarterKeyFn = (iso: string | null | undefined) =>
    fiscalQuarterFromDate(iso)?.key ?? null;

  const primaryQuarterKey =
    selectedQuarters?.size === 1 ? [...selectedQuarters][0]! : null;
  const metricsAsOf = primaryQuarterKey
    ? asOfDateForQuarter(primaryQuarterKey, asOfDate)
    : asOfDate;

  let priorQuarterKeys: Set<string> | null = null;
  if (primaryQuarterKey) {
    const prev = previousFiscalQuarterKey(primaryQuarterKey);
    if (prev) priorQuarterKeys = new Set([prev]);
  }

  const metrics = buildRenewalMetrics({
    views: allViews,
    quarterKeys: selectedQuarters,
    quarterKeyFn,
    priorQuarterKeys,
    asOfDate: metricsAsOf,
  });

  const oppRows = buildRenewalOppRows(allViews, selectedQuarters, quarterKeyFn, metricsAsOf);
  const knownChurnRows = buildKnownChurnOppRows(allViews, selectedQuarters, quarterKeyFn);
  const accounts = buildRenewalAccountRows(oppRows, metricsAsOf);
  const atRisk30 = buildAtRiskPipeline(allViews, 30, asOfDate);

  const quarterLabel =
    selectedQuarters === null
      ? 'All quarters'
      : [...selectedQuarters].map(fiscalQuarterLabel).join(', ');

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Renewal analysis</h1>
          <p className="text-xs text-gray-500">
            Account-level drilldown · Expand 3 · Last refresh: <RelativeTime iso={startedAt} />
          </p>
        </div>
        <RefreshButton />
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />

      <RenewalAnalysisClient
        metrics={metrics}
        accounts={accounts}
        knownChurnRows={knownChurnRows}
        atRisk30={atRisk30}
        quarterLabel={quarterLabel}
        initialOutcomeFilter={outcome ?? null}
        initialKnownChurn={knownChurn === '1'}
      />
    </div>
  );
}

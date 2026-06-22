import { getDashboardData } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { RenewalNav } from '@/components/RenewalNav';
import { RelativeTime } from '@/components/ui';
import {
  effectiveQuartersForBucket,
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  fiscalQuartersForAccount,
  parseQuartersParam,
  previousFiscalQuarterKey,
  type FiscalQuarterBucket,
} from '@/lib/fiscal';
import {
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
  searchParams: Promise<{
    quarters?: string;
    outcome?: string;
    knownChurn?: string;
    view?: string;
  }>;
}) {
  const { quarters, outcome, knownChurn, view } = await searchParams;
  const asOfDate = new Date().toISOString();
  const analysisView = view === 'quarter-close' ? 'quarter-close' : 'pipeline';
  const quarterBucket: FiscalQuarterBucket =
    analysisView === 'quarter-close' ? 'retrospective' : 'prospective';
  const { views: allViews, refreshId, startedAt } = await getDashboardData();

  if (!refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Renewal pipeline</h1>
        <p className="text-gray-700">
          No data yet. Run <code>make seed</code> or click Refresh.
        </p>
        <RefreshButton />
      </div>
    );
  }

  const selectedQuarters = effectiveQuartersForBucket(
    parseQuartersParam(quarters),
    quarterBucket,
    new Date(asOfDate),
  );
  const availableQuarterKeys = Array.from(
    new Set(allViews.flatMap((v) => fiscalQuartersForAccount(v))),
  );

  const quarterKeyFn = (iso: string | null | undefined) =>
    fiscalQuarterFromDate(iso)?.key ?? null;

  const primaryQuarterKey =
    selectedQuarters.size === 1 ? [...selectedQuarters][0]! : null;
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

  const quarterLabel = [...selectedQuarters].map(fiscalQuarterLabel).join(', ');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Renewals</h1>
          <RenewalNav />
          <p className="text-xs text-gray-500">
            Workbench · Expand 3 · Last refresh: <RelativeTime iso={startedAt} />
          </p>
        </div>
        <RefreshButton />
      </div>

      <RenewalAnalysisClient
        metrics={metrics}
        accounts={accounts}
        oppRows={oppRows}
        knownChurnRows={knownChurnRows}
        quarterLabel={quarterLabel}
        initialView={analysisView}
        quarterBucket={quarterBucket}
        availableQuarterKeys={availableQuarterKeys}
        initialOutcomeFilter={outcome ?? null}
        initialKnownChurn={knownChurn === '1'}
      />
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { OverallAssessmentCell } from '@/components/OverallAssessmentCell';
import { EngagementDaysCell } from '@/components/EngagementDaysCell';
import { LabelWithHint, MetricHint } from '@/components/MetricHint';
import { RenewalPipelineTable } from '@/components/RenewalPipelineTable';
import { useLocalStorage } from '@/components/useLocalStorage';
import {
  Card,
  AssessmentPill,
  fmtUSD,
  StatTile,
} from '@/components/ui';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import { RENEWAL_METRIC_HINTS } from '@/lib/renewal-metric-tooltips';
import {
  DEFAULT_RENEWAL_WORKBENCH_SORT,
  renewalWorkbenchSortSerializer,
  RENEWAL_WORKBENCH_SORT_KEY,
  type RenewalWorkbenchSortField,
} from '@/lib/renewal-workbench-sort';
import { defaultFiscalQuarterForBucket, type FiscalQuarterBucket } from '@/lib/fiscal';
import type {
  KnownChurnOppRow,
  RenewalAccountRow,
  RenewalMetricsSummary,
  RenewalOppRow,
  RenewalOutcome,
} from '@mdas/renewal-metrics';
import {
  filterAtRiskByOverallAssessment,
  filterUpcomingRenewals,
  isClosedRenewalOutcome,
  isOpenRenewalOppRow,
  overallAssessmentSortRank,
  prospectivePipelineStatus,
} from '@mdas/renewal-metrics';

const OUTCOME_LABELS: Record<RenewalOutcome, string> = {
  flat: 'Renewed flat',
  downsell: 'Downsell',
  full_churn: 'Full churn',
  expanded: 'Expanded',
  pending: 'Open',
  pushed: 'Pushed',
};

const OUTCOME_COLORS: Record<RenewalOutcome, string> = {
  flat: 'bg-emerald-500',
  downsell: 'bg-amber-500',
  full_churn: 'bg-red-600',
  expanded: 'bg-violet-500',
  pending: 'bg-blue-400',
  pushed: 'bg-orange-400',
};

const RETROSPECTIVE_OUTCOMES: RenewalOutcome[] = [
  'flat',
  'downsell',
  'full_churn',
  'expanded',
];

type SortField = RenewalWorkbenchSortField;

const OVERALL_ASSESSMENT_NONE = '__none__';

const OVERALL_ASSESSMENT_COLORS: Record<string, string> = {
  Critical: 'bg-red-600',
  High: 'bg-orange-600',
  Medium: 'bg-yellow-500',
  Low: 'bg-green-600',
  [OVERALL_ASSESSMENT_NONE]: 'bg-gray-400',
};

const OVERALL_ASSESSMENT_LABELS: Record<string, string> = {
  Critical: 'Critical',
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  [OVERALL_ASSESSMENT_NONE]: 'Not synced',
};

const OVERALL_ASSESSMENT_ORDER = ['Critical', 'High', 'Medium', 'Low', OVERALL_ASSESSMENT_NONE];

type DrilldownView = 'atr' | 'renewal-date' | 'health';

const DRILLDOWN_VIEWS: { id: DrilldownView; label: string; field: SortField; direction: SortDirection }[] = [
  { id: 'renewal-date', label: 'By renewal date', field: 'renewalDate', direction: 'asc' },
  { id: 'atr', label: 'By ATR', field: 'atr', direction: 'desc' },
  { id: 'health', label: 'By health', field: 'health', direction: 'desc' },
];

type KpiFilter =
  | 'all'
  | 'pipeline'
  | 'pushed'
  | 'at_risk'
  | 'upcoming_30'
  | 'atr_up'
  | 'renewed'
  | 'churned'
  | 'full_churn_rate'
  | 'downsell_rate'
  | 'grr'
  | 'known_churn';

type AnalysisMode = 'pipeline' | 'quarter-close';

function pct(n: number | null, digits = 1): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function deltaLabel(current: number, prior: number | undefined, invert = false): string | undefined {
  if (prior == null || prior === 0) return undefined;
  const change = ((current - prior) / Math.abs(prior)) * 100;
  const good = invert ? change < 0 : change > 0;
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}% vs prior qtr ${good ? '▲' : '▼'}`;
}

function CardTitle({ title, hint }: { title: string; hint?: string }): JSX.Element {
  return (
    <div className="mb-3 flex items-center text-sm font-semibold text-gray-900">
      {hint ? <LabelWithHint label={title} hint={hint} /> : title}
    </div>
  );
}

function ShowClosedRenewalsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
      <input
        type="checkbox"
        className="rounded border-gray-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Show closed
    </label>
  );
}

function matchesOverallAssessmentFilter(
  category: string | null,
  filter: Set<string>,
): boolean {
  if (filter.size === 0) return true;
  const key = category ?? OVERALL_ASSESSMENT_NONE;
  return filter.has(key);
}

function BarCompare({
  atr,
  renewed,
  churned,
  downsell,
}: {
  atr: number;
  renewed: number;
  churned: number;
  downsell: number;
}) {
  const max = Math.max(atr, renewed, 1);
  const bar = (value: number, color: string, label: string) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="tabular-nums font-medium">{fmtUSD(value)}</span>
      </div>
      <div className="h-3 w-full rounded bg-gray-100">
        <div
          className={`h-3 rounded ${color}`}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
          role="img"
          aria-label={`${label}: ${fmtUSD(value)}`}
        />
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      {bar(atr, 'bg-slate-500', 'ATR up for renewal')}
      {bar(renewed, 'bg-emerald-600', 'Renewed revenue (derived)')}
      {bar(churned, 'bg-red-600', 'ATR churned (full logo)')}
      {bar(downsell, 'bg-amber-500', 'Downsell amount')}
    </div>
  );
}

function Waterfall({ bridge }: { bridge: RenewalMetricsSummary['bridge'] }) {
  const steps = [
    { label: 'Starting ATR', value: bridge.startingAtrUSD, color: 'bg-slate-500' },
    { label: '− Full churn', value: -bridge.fullChurnUSD, color: 'bg-red-500' },
    { label: '− Downsell', value: -bridge.downsellUSD, color: 'bg-amber-500' },
    { label: '+ Expansion', value: bridge.expansionUSD, color: 'bg-violet-500' },
    { label: '= Renewed revenue', value: bridge.endingRenewedUSD, color: 'bg-emerald-600' },
  ];
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
          <span className="w-36 text-gray-600">{s.label}</span>
          <div className="flex-1">
            <div
              className={`h-2 rounded ${s.color}`}
              style={{
                width: `${Math.min(
                  100,
                  (Math.abs(s.value) / Math.max(bridge.startingAtrUSD, 1)) * 100,
                )}%`,
              }}
            />
          </div>
          <span className="w-24 text-right tabular-nums font-medium">
            {s.value < 0 ? `(${fmtUSD(Math.abs(s.value))})` : fmtUSD(s.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function OverallAssessmentBreakdown({
  counts,
  activeFilters,
  onCategoryClick,
}: {
  counts: { category: string; count: number }[];
  activeFilters: Set<string>;
  onCategoryClick: (category: string) => void;
}) {
  const total = counts.reduce((s, { count }) => s + count, 0) || 1;

  if (counts.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No renewal opportunities in scope. Adjust the fiscal quarter filter.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full overflow-hidden rounded text-[10px] font-medium text-white">
        {counts.map(({ category, count }) => {
          const share = (count / total) * 100;
          const label = OVERALL_ASSESSMENT_LABELS[category] ?? category;
          return (
            <button
              key={category}
              type="button"
              className={`${OVERALL_ASSESSMENT_COLORS[category] ?? 'bg-gray-400'} flex items-center justify-center overflow-hidden px-0.5 transition-opacity ${
                activeFilters.size > 0 && !activeFilters.has(category) ? 'opacity-40' : 'opacity-100'
              } ${activeFilters.has(category) ? 'ring-2 ring-inset ring-gray-900/30' : ''}`}
              style={{ width: `${share}%` }}
              title={`${label}: ${count} (${pct(count / total, 0)})`}
              onClick={() => onCategoryClick(category)}
            >
              {share >= 14 ? (
                <span className="truncate">
                  {label} {pct(count / total, 0)}
                </span>
              ) : share >= 8 ? (
                <span>{pct(count / total, 0)}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        {counts.map(({ category, count }) => {
          const label = OVERALL_ASSESSMENT_LABELS[category] ?? category;
          const active = activeFilters.has(category);
          return (
            <li key={category}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors ${
                  active ? 'bg-gray-100 ring-1 ring-gray-300' : 'hover:bg-gray-50'
                } ${activeFilters.size > 0 && !active ? 'opacity-50' : ''}`}
                onClick={() => onCategoryClick(category)}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded ${OVERALL_ASSESSMENT_COLORS[category] ?? 'bg-gray-400'}`}
                />
                <span>{label}</span>
                <span className="ml-auto tabular-nums text-gray-600">
                  {count} ({pct(count / total, 0)})
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OutcomeBreakdown({
  counts,
  retrospectiveOnly = true,
}: {
  counts: RenewalMetricsSummary['outcomeCounts'];
  retrospectiveOnly?: boolean;
}) {
  const entries = (Object.entries(counts) as [RenewalOutcome, number][])
    .filter(([outcome, n]) => n > 0 && (!retrospectiveOnly || RETROSPECTIVE_OUTCOMES.includes(outcome)));
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No closed renewal outcomes in scope yet. Outcomes appear after deals close.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full overflow-hidden rounded text-[10px] font-medium text-white">
        {entries.map(([outcome, count]) => {
          const share = (count / total) * 100;
          return (
            <div
              key={outcome}
              className={`${OUTCOME_COLORS[outcome]} flex items-center justify-center overflow-hidden px-0.5`}
              style={{ width: `${share}%` }}
              title={`${OUTCOME_LABELS[outcome]}: ${count} (${pct(count / total, 0)})`}
            >
              {share >= 14 ? (
                <span className="truncate">
                  {OUTCOME_LABELS[outcome]} {pct(count / total, 0)}
                </span>
              ) : share >= 8 ? (
                <span>{pct(count / total, 0)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        {entries.map(([outcome, count]) => (
          <li key={outcome} className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded ${OUTCOME_COLORS[outcome]}`} />
            <span>{OUTCOME_LABELS[outcome]}</span>
            <span className="ml-auto tabular-nums text-gray-600">
              {count} ({pct(count / total, 0)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReasonTable({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: { reason: string; accountCount: number; atrUSD: number }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <CardTitle title={title} hint={hint} />
        <p className="text-sm text-gray-500">No reasons recorded for closed churn/downsell in scope.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <CardTitle title={title} hint={hint} />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-gray-500">
            <th className="py-2">Reason</th>
            <th className="py-2 text-right">Accounts</th>
            <th className="py-2 text-right">ATR</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.reason} className="border-b border-gray-100">
              <td className="py-2 pr-2">{r.reason}</td>
              <td className="py-2 text-right tabular-nums">{r.accountCount}</td>
              <td className="py-2 text-right tabular-nums">{fmtUSD(r.atrUSD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface RenewalAnalysisClientProps {
  metrics: RenewalMetricsSummary;
  accounts: RenewalAccountRow[];
  oppRows: RenewalOppRow[];
  knownChurnRows: KnownChurnOppRow[];
  quarterLabel: string;
  initialView: 'pipeline' | 'quarter-close';
  quarterBucket: FiscalQuarterBucket;
  availableQuarterKeys: string[];
  initialOutcomeFilter?: string | null;
  initialKnownChurn?: boolean;
}

export function RenewalAnalysisClient({
  metrics,
  accounts,
  oppRows,
  knownChurnRows,
  quarterLabel,
  initialView,
  quarterBucket,
  availableQuarterKeys,
  initialOutcomeFilter,
  initialKnownChurn = false,
}: RenewalAnalysisClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validOutcomes = new Set<string>(RETROSPECTIVE_OUTCOMES);
  const initialOutcome =
    initialOutcomeFilter && validOutcomes.has(initialOutcomeFilter)
      ? (initialOutcomeFilter as RenewalOutcome)
      : null;

  const [mode, setMode] = useState<AnalysisMode>(
    initialView === 'quarter-close' ? 'quarter-close' : 'pipeline',
  );
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(
    initialKnownChurn ? 'known_churn' : 'all',
  );
  const [outcomeFilter, setOutcomeFilter] = useState<Set<RenewalOutcome>>(
    () => (initialOutcome ? new Set([initialOutcome]) : new Set()),
  );
  const [cseFilter, setCseFilter] = useState<Set<string>>(new Set());
  const [overallAssessmentFilter, setOverallAssessmentFilter] = useState<Set<string>>(new Set());
  const [drilldownView, setDrilldownView] = useState<DrilldownView>('atr');
  const [sort, setSort] = useLocalStorage(
    RENEWAL_WORKBENCH_SORT_KEY,
    DEFAULT_RENEWAL_WORKBENCH_SORT,
    renewalWorkbenchSortSerializer,
  );
  const sortField = sort.field;
  const sortDirection = sort.direction;
  const [showClosedRenewals, setShowClosedRenewals] = useState(false);
  const [upcoming30SortDirection, setUpcoming30SortDirection] = useState<SortDirection>('asc');

  const switchMode = (next: AnalysisMode) => {
    setMode(next);
    setKpiFilter('all');
    setOutcomeFilter(new Set());
    setOverallAssessmentFilter(new Set());
    const bucket: FiscalQuarterBucket =
      next === 'quarter-close' ? 'retrospective' : 'prospective';
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', next === 'quarter-close' ? 'quarter-close' : 'pipeline');
    params.set('quarters', defaultFiscalQuarterForBucket(bucket));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const applyDrilldownView = (view: DrilldownView) => {
    const preset = DRILLDOWN_VIEWS.find((v) => v.id === view)!;
    setDrilldownView(view);
    setSort({ field: preset.field, direction: preset.direction });
  };

  const cseOptions = useMemo(() => {
    const names = new Set<string>();
    const source = mode === 'pipeline' ? oppRows : accounts;
    for (const row of source) {
      if (row.cseName) names.add(row.cseName);
    }
    return Array.from(names).sort().map((n) => ({ value: n, label: n }));
  }, [accounts, oppRows, mode]);

  const overallAssessmentOptions = useMemo(() => {
    const categories = new Set<string>();
    let hasMissing = false;
    const source = mode === 'pipeline' ? oppRows : accounts;
    for (const row of source) {
      if (row.overallAssessment) categories.add(row.overallAssessment);
      else hasMissing = true;
    }
    const order = ['Critical', 'High', 'Medium', 'Low'];
    const options = order
      .filter((c) => categories.has(c))
      .map((c) => ({ value: c, label: c }));
    if (hasMissing) {
      options.push({ value: OVERALL_ASSESSMENT_NONE, label: 'Not synced' });
    }
    return options;
  }, [accounts, oppRows, mode]);

  const openPipelineOpps = useMemo(
    () => oppRows.filter((o) => isOpenRenewalOppRow(o)),
    [oppRows],
  );

  const atRiskOpps = useMemo(
    () => filterAtRiskByOverallAssessment(openPipelineOpps),
    [openPipelineOpps],
  );

  const upcoming30Opps = useMemo(
    () => filterUpcomingRenewals(openPipelineOpps, 30),
    [openPipelineOpps],
  );

  const sortedUpcoming30Opps = useMemo(() => {
    const dir = upcoming30SortDirection === 'asc' ? 1 : -1;
    return [...upcoming30Opps].sort((a, b) => {
      const da = a.closeDate ? Date.parse(a.closeDate) : Number.POSITIVE_INFINITY;
      const db = b.closeDate ? Date.parse(b.closeDate) : Number.POSITIVE_INFINITY;
      if (da !== db) return (da - db) * dir;
      return a.accountName.localeCompare(b.accountName) * dir;
    });
  }, [upcoming30Opps, upcoming30SortDirection]);

  const closedPipelineOpps = useMemo(
    () => oppRows.filter((o) => isClosedRenewalOutcome(o.outcome)),
    [oppRows],
  );

  const pipelineOpps = useMemo(
    () => (showClosedRenewals ? oppRows : openPipelineOpps),
    [oppRows, openPipelineOpps, showClosedRenewals],
  );

  const filteredOpps = useMemo(() => {
    let rows = pipelineOpps;

    if (kpiFilter === 'pipeline') {
      rows = rows.filter((o) => isOpenRenewalOppRow(o));
    } else if (kpiFilter === 'pushed') {
      rows = rows.filter((o) => o.outcome === 'pushed');
    } else if (kpiFilter === 'at_risk') {
      rows = rows.filter((o) => atRiskOpps.some((a) => a.opportunityId === o.opportunityId));
    } else if (kpiFilter === 'upcoming_30') {
      rows = rows.filter((o) => upcoming30Opps.some((a) => a.opportunityId === o.opportunityId));
    }

    if (cseFilter.size > 0) {
      rows = rows.filter((o) => o.cseName && cseFilter.has(o.cseName));
    }

    if (overallAssessmentFilter.size > 0) {
      rows = rows.filter((o) =>
        matchesOverallAssessmentFilter(o.overallAssessment, overallAssessmentFilter),
      );
    }

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const cmp = (x: number | string | null, y: number | string | null) => {
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
      };
      switch (sortField) {
        case 'account':
          return cmp(a.accountName, b.accountName);
        case 'opportunity':
          return cmp(a.opportunityName, b.opportunityName);
        case 'cse':
          return cmp(a.cseName, b.cseName);
        case 'renewalDate':
          return cmp(a.closeDate, b.closeDate);
        case 'stage':
          return cmp(a.stageName, b.stageName);
        case 'renewed':
          return cmp(a.renewedRevenueUSD, b.renewedRevenueUSD);
        case 'downsell':
          return cmp(a.downsellAmountUSD, b.downsellAmountUSD);
        case 'outcome':
          return cmp(a.outcome, b.outcome);
        case 'health':
          return cmp(a.healthScore, b.healthScore);
        case 'overallAssessment':
          return (
            cmp(
              overallAssessmentSortRank(a.overallAssessment),
              overallAssessmentSortRank(b.overallAssessment),
            )
          );
        case 'slackUpdate':
          return cmp(a.daysSinceSlackUpdate, b.daysSinceSlackUpdate);
        case 'customerEngagement':
          return cmp(a.daysSinceCustomerEngagement, b.daysSinceCustomerEngagement);
        default:
          return cmp(a.atrUSD, b.atrUSD);
      }
    });
  }, [pipelineOpps, kpiFilter, cseFilter, overallAssessmentFilter, sortField, sortDirection, atRiskOpps, upcoming30Opps]);

  const pipelineAccounts = useMemo(
    () => accounts.filter((a) => !isClosedRenewalOutcome(a.outcome)),
    [accounts],
  );

  const overallAssessmentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const opp of pipelineOpps) {
      const key = opp.overallAssessment ?? OVERALL_ASSESSMENT_NONE;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return OVERALL_ASSESSMENT_ORDER.filter((category) => (map.get(category) ?? 0) > 0).map(
      (category) => ({ category, count: map.get(category)! }),
    );
  }, [pipelineOpps]);

  const toggleOverallAssessmentCategory = (category: string) => {
    setOverallAssessmentFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const filteredAccounts = useMemo(() => {
    let rows = mode === 'pipeline' ? pipelineAccounts : accounts;

    if (mode === 'pipeline') {
      if (kpiFilter === 'pipeline') {
        rows = rows.filter((a) => a.outcome === 'pending' || a.outcome === 'pushed');
      } else if (kpiFilter === 'pushed') {
        rows = rows.filter((a) => a.outcome === 'pushed');
      }
    } else {
      if (kpiFilter === 'churned' || kpiFilter === 'full_churn_rate') {
        rows = rows.filter((a) => a.outcome === 'full_churn');
      } else if (kpiFilter === 'downsell_rate') {
        rows = rows.filter((a) => a.outcome === 'downsell');
      }
      if (outcomeFilter.size > 0) {
        rows = rows.filter((a) => outcomeFilter.has(a.outcome));
      }
    }

    if (cseFilter.size > 0) {
      rows = rows.filter((a) => a.cseName && cseFilter.has(a.cseName));
    }

    if (overallAssessmentFilter.size > 0) {
      rows = rows.filter((a) =>
        matchesOverallAssessmentFilter(a.overallAssessment, overallAssessmentFilter),
      );
    }

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const cmp = (x: number | string | null, y: number | string | null) => {
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
      };
      switch (sortField) {
        case 'account':
          return cmp(a.accountName, b.accountName);
        case 'cse':
          return cmp(a.cseName, b.cseName);
        case 'renewalDate':
          return cmp(a.renewalDate, b.renewalDate);
        case 'renewed':
          return cmp(a.renewedRevenueUSD, b.renewedRevenueUSD);
        case 'churned':
          return cmp(a.churnedAtrUSD, b.churnedAtrUSD);
        case 'downsell':
          return cmp(a.downsellAmountUSD, b.downsellAmountUSD);
        case 'outcome':
          return cmp(a.outcome, b.outcome);
        case 'health':
          return cmp(a.healthScore, b.healthScore);
        case 'overallAssessment':
          return (
            cmp(
              overallAssessmentSortRank(a.overallAssessment),
              overallAssessmentSortRank(b.overallAssessment),
            )
          );
        case 'slackUpdate':
          return cmp(a.daysSinceSlackUpdate, b.daysSinceSlackUpdate);
        case 'customerEngagement':
          return cmp(a.daysSinceCustomerEngagement, b.daysSinceCustomerEngagement);
        default:
          return cmp(a.atrUSD, b.atrUSD);
      }
    });
  }, [accounts, pipelineAccounts, mode, kpiFilter, outcomeFilter, cseFilter, overallAssessmentFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    setSort((prev) => ({
      field,
      direction: prev.field === field ? (prev.direction === 'asc' ? 'desc' : 'asc') : 'desc',
    }));
    setDrilldownView('atr');
  };

  const prior = metrics.priorPeriod;
  const isPipeline = mode === 'pipeline';
  const notSyncedAssessmentCount =
    overallAssessmentCounts.find((c) => c.category === OVERALL_ASSESSMENT_NONE)?.count ?? 0;
  const overallAssessmentScopeLabel = showClosedRenewals
    ? `${pipelineOpps.length} renewal opportunit${pipelineOpps.length === 1 ? 'y' : 'ies'} in scope (${openPipelineOpps.length} open · ${closedPipelineOpps.length} closed)`
    : `${openPipelineOpps.length} open renewal opportunit${openPipelineOpps.length === 1 ? 'y' : 'ies'} in scope`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          <strong>{isPipeline ? 'Forward-looking pipeline' : 'Quarter-close review'}</strong> for{' '}
          <strong>{quarterLabel}</strong>.
          {isPipeline
            ? ' Filter and act on open renewals in the prospective window.'
            : ' Review closed outcomes, GRR, and churn/downsell reasons after the quarter ends.'}
        </p>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm shadow-sm">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 font-medium ${isPipeline ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => switchMode('pipeline')}
          >
            Pipeline
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 font-medium ${!isPipeline ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => switchMode('quarter-close')}
            title="Review last 8 completed quarters — outcomes and churn/downsell reasons"
          >
            Quarter close
          </button>
        </div>
      </div>

      <FiscalQuarterFilter
        availableQuarterKeys={availableQuarterKeys}
        quarterBucket={quarterBucket}
      />

      {isPipeline ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label={
              <LabelWithHint label="Open pipeline ATR" hint={RENEWAL_METRIC_HINTS.pipelineAtr} />
            }
            value={fmtUSD(metrics.openRenewalAtrUSD)}
            sub={`${openPipelineOpps.length} open · ${closedPipelineOpps.length} closed opps`}
            onClick={() => setKpiFilter(kpiFilter === 'pipeline' ? 'all' : 'pipeline')}
            active={kpiFilter === 'pipeline'}
          />
          <StatTile
            label={
              <LabelWithHint label="Pushed renewals" hint={RENEWAL_METRIC_HINTS.pushedRenewals} />
            }
            value={String(metrics.pushedRenewalCount)}
            sub="Past close, still open"
            onClick={() => setKpiFilter(kpiFilter === 'pushed' ? 'all' : 'pushed')}
            active={kpiFilter === 'pushed'}
          />
          <StatTile
            label={
              <LabelWithHint label="At-risk renewals" hint={RENEWAL_METRIC_HINTS.atRiskPipeline} />
            }
            value={String(atRiskOpps.length)}
            sub={`${fmtUSD(atRiskOpps.reduce((s, o) => s + o.atrUSD, 0))} ATR · Critical/High`}
            onClick={() => setKpiFilter(kpiFilter === 'at_risk' ? 'all' : 'at_risk')}
            active={kpiFilter === 'at_risk'}
          />
          <StatTile
            label={
              <LabelWithHint label="Next 30 days" hint={RENEWAL_METRIC_HINTS.renewalsNext30Days} />
            }
            value={String(upcoming30Opps.length)}
            sub={fmtUSD(upcoming30Opps.reduce((s, o) => s + o.atrUSD, 0)) + ' ATR closing soon'}
            onClick={() => setKpiFilter(kpiFilter === 'upcoming_30' ? 'all' : 'upcoming_30')}
            active={kpiFilter === 'upcoming_30'}
          />
          <StatTile
            label={<LabelWithHint label="Total book ATR" hint={RENEWAL_METRIC_HINTS.atrUp} />}
            value={fmtUSD(metrics.atrUpForRenewalUSD)}
            sub={`${metrics.accountsUpForRenewal} accts · ${openPipelineOpps.length} open opps`}
            onClick={() => setKpiFilter(kpiFilter === 'atr_up' ? 'all' : 'atr_up')}
            active={kpiFilter === 'atr_up'}
          />
          <StatTile
            label={<LabelWithHint label="Known churn" hint={RENEWAL_METRIC_HINTS.knownChurn} />}
            value={fmtUSD(metrics.knownChurn.atrUSD)}
            sub={`${metrics.knownChurn.accountCount} accts · ${metrics.knownChurn.opportunityCount} opps`}
            onClick={() => setKpiFilter(kpiFilter === 'known_churn' ? 'all' : 'known_churn')}
            active={kpiFilter === 'known_churn'}
          />
        </div>
      ) : null}

      {isPipeline && oppRows.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center text-sm font-semibold text-gray-900">
              <LabelWithHint
                label="Overall Assessment"
                hint={RENEWAL_METRIC_HINTS.overallAssessmentBreakdown}
              />
            </div>
            <ShowClosedRenewalsToggle
              checked={showClosedRenewals}
              onChange={setShowClosedRenewals}
            />
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {overallAssessmentScopeLabel}
            {notSyncedAssessmentCount > 0
              ? ` · ${notSyncedAssessmentCount} awaiting Cerebro sync`
              : ''}
          </p>
          <OverallAssessmentBreakdown
            counts={overallAssessmentCounts}
            activeFilters={overallAssessmentFilter}
            onCategoryClick={toggleOverallAssessmentCategory}
          />
        </div>
      ) : null}

      {!isPipeline ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatTile
            label={<LabelWithHint label="ATR up for renewal" hint={RENEWAL_METRIC_HINTS.atrUp} />}
            value={fmtUSD(metrics.atrUpForRenewalUSD)}
            sub={deltaLabel(metrics.atrUpForRenewalUSD, prior?.atrUpForRenewalUSD)}
            onClick={() => setKpiFilter(kpiFilter === 'atr_up' ? 'all' : 'atr_up')}
            active={kpiFilter === 'atr_up'}
          />
          <StatTile
            label={<LabelWithHint label="Renewed revenue" hint={RENEWAL_METRIC_HINTS.renewed} />}
            value={fmtUSD(metrics.renewedRevenueUSD)}
            sub={
              metrics.atrUpForRenewalUSD > 0
                ? `${pct(metrics.grossRevenueRetentionPct)} of ATR`
                : deltaLabel(metrics.renewedRevenueUSD, prior?.renewedRevenueUSD)
            }
            onClick={() => setKpiFilter(kpiFilter === 'renewed' ? 'all' : 'renewed')}
            active={kpiFilter === 'renewed'}
          />
          <StatTile
            label={<LabelWithHint label="ATR churned" hint={RENEWAL_METRIC_HINTS.atrChurned} />}
            value={fmtUSD(metrics.atrChurnedUSD)}
            sub={
              metrics.atrUpForRenewalUSD > 0
                ? `${pct(metrics.atrChurnedUSD / metrics.atrUpForRenewalUSD)} of ATR`
                : deltaLabel(metrics.atrChurnedUSD, prior?.atrChurnedUSD, true)
            }
            onClick={() => setKpiFilter(kpiFilter === 'churned' ? 'all' : 'churned')}
            active={kpiFilter === 'churned'}
          />
          <StatTile
            label={
              <LabelWithHint label="Full logo churn rate" hint={RENEWAL_METRIC_HINTS.fullChurnRate} />
            }
            value={pct(metrics.fullLogoChurnRate)}
            sub={`${metrics.fullChurnAccountCount} / ${metrics.accountsUpForRenewal} accounts`}
            onClick={() => setKpiFilter(kpiFilter === 'full_churn_rate' ? 'all' : 'full_churn_rate')}
            active={kpiFilter === 'full_churn_rate'}
          />
          <StatTile
            label={
              <LabelWithHint label="Downsell account rate" hint={RENEWAL_METRIC_HINTS.downsellRate} />
            }
            value={pct(metrics.downsellAccountRate)}
            sub={`${metrics.downsellAccountCount} accts · ${fmtUSD(metrics.downsellAmountUSD)}`}
            onClick={() => setKpiFilter(kpiFilter === 'downsell_rate' ? 'all' : 'downsell_rate')}
            active={kpiFilter === 'downsell_rate'}
          />
          <StatTile
            label={<LabelWithHint label="Renewal retention (GRR)" hint={RENEWAL_METRIC_HINTS.grr} />}
            value={pct(metrics.grossRevenueRetentionPct)}
            sub="Renewed ÷ ATR"
            onClick={() => setKpiFilter(kpiFilter === 'grr' ? 'all' : 'grr')}
            active={kpiFilter === 'grr'}
          />
          <StatTile
            label={<LabelWithHint label="Known churn" hint={RENEWAL_METRIC_HINTS.knownChurn} />}
            value={fmtUSD(metrics.knownChurn.atrUSD)}
            sub={`${metrics.knownChurn.accountCount} accts`}
            onClick={() => setKpiFilter(kpiFilter === 'known_churn' ? 'all' : 'known_churn')}
            active={kpiFilter === 'known_churn'}
          />
        </div>
      ) : null}

      {!isPipeline ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="ATR vs renewed revenue">
            <BarCompare
              atr={metrics.atrUpForRenewalUSD}
              renewed={metrics.renewedRevenueUSD}
              churned={metrics.atrChurnedUSD}
              downsell={metrics.downsellAmountUSD}
            />
          </Card>
          <Card title="Revenue bridge">
            <Waterfall bridge={metrics.bridge} />
          </Card>
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <CardTitle title="Renewal outcome breakdown" hint={RENEWAL_METRIC_HINTS.outcomeBreakdown} />
            <OutcomeBreakdown counts={metrics.retrospectiveOutcomeCounts} />
          </div>
        </div>
      ) : null}

      {!isPipeline ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ReasonTable
            title="Top churn reasons (by ATR)"
            hint={RENEWAL_METRIC_HINTS.churnReasons}
            rows={metrics.topChurnReasonsByAtr}
          />
          <ReasonTable
            title="Top downsell reasons (by ATR)"
            hint={RENEWAL_METRIC_HINTS.downsellReasons}
            rows={metrics.topDownsellReasonsByAtr}
          />
        </div>
      ) : null}

      {isPipeline && upcoming30Opps.length > 0 ? (
        <Card
          title="Renewals closing in the next 30 days"
          right={
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
              onClick={() =>
                setUpcoming30SortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
              }
              title="Sort by close date"
            >
              Close date
              <span className="text-gray-500">{upcoming30SortDirection === 'asc' ? '↑' : '↓'}</span>
            </button>
          }
        >
          <p className="mb-3 text-xs text-gray-500">{RENEWAL_METRIC_HINTS.renewalsNext30Days}</p>
          <ul className="space-y-1 text-sm">
            {sortedUpcoming30Opps.slice(0, 15).map((o) => (
              <li
                key={o.opportunityId}
                className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 ${
                  o.overallAssessment === 'Critical'
                    ? 'bg-red-50'
                    : o.overallAssessment === 'High'
                      ? 'bg-orange-50'
                      : o.overallAssessment === 'Medium'
                        ? 'bg-yellow-50/60'
                        : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AssessmentPill category={o.overallAssessment} />
                  <Link
                    href={`/accounts/${o.accountId}`}
                    className="truncate font-medium hover:underline"
                  >
                    {o.accountName}
                  </Link>
                  <span className="shrink-0 tabular-nums text-xs text-gray-500">
                    · {o.closeDate ?? '—'}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-gray-700">{fmtUSD(o.atrUSD)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              {kpiFilter === 'known_churn'
                ? 'Known churn drilldown'
                : isPipeline
                  ? 'Renewal pipeline'
                  : 'Renewal drilldown'}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {kpiFilter === 'known_churn'
                ? `${knownChurnRows.length} opportunities`
                : isPipeline
                  ? `${filteredOpps.length}${filteredOpps.length !== pipelineOpps.length ? ` of ${pipelineOpps.length}` : ''} opportunities · ${closedPipelineOpps.length} closed in scope`
                  : `${filteredAccounts.length}${filteredAccounts.length !== accounts.length ? ` of ${accounts.length}` : ''} accounts`}
              {isPipeline && kpiFilter !== 'known_churn' ? ' · drag column headers to reorder' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPipeline && kpiFilter !== 'known_churn' ? (
              <ShowClosedRenewalsToggle
                checked={showClosedRenewals}
                onChange={setShowClosedRenewals}
              />
            ) : null}
            {kpiFilter !== 'known_churn' && (isPipeline ? filteredOpps.length : filteredAccounts.length) > 0 ? (
              <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs">
                {DRILLDOWN_VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`rounded px-2.5 py-1 font-medium transition-colors ${
                      drilldownView === v.id
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                    onClick={() => applyDrilldownView(v.id)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-5 pt-4">
        {kpiFilter === 'known_churn' ? (
          knownChurnRows.length === 0 ? (
            <p className="text-sm text-gray-500">No known-churn renewal opportunities in scope.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Account</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Opportunity</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">CSE</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Close date</th>
                    <th className="px-2 py-2 text-right text-xs font-medium uppercase text-gray-500">ATR</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {knownChurnRows.map((r) => (
                    <tr key={r.opportunityId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-2 py-2">
                        <Link href={`/accounts/${r.accountId}`} className="font-medium hover:underline">
                          {r.accountName}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{r.opportunityName}</td>
                      <td className="px-2 py-2">{r.cseName ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{r.closeDate ?? '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(r.atrUSD)}</td>
                      <td className="max-w-[200px] truncate px-2 py-2 text-gray-600" title={r.reason ?? undefined}>
                        {r.reason ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : isPipeline ? (
          filteredOpps.length === 0 ? (
            <p className="text-sm text-gray-500">
              No {showClosedRenewals ? 'renewals' : 'open renewals'} in the selected period.
              {showClosedRenewals ? ' Adjust the fiscal quarter filter.' : ' Enable “Show closed renewals” or adjust the fiscal quarter filter.'}
            </p>
          ) : (
            <RenewalPipelineTable
              rows={filteredOpps}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              cseOptions={cseOptions}
              cseFilter={cseFilter}
              onCseFilterChange={setCseFilter}
              overallAssessmentOptions={overallAssessmentOptions}
              overallAssessmentFilter={overallAssessmentFilter}
              onOverallAssessmentFilterChange={setOverallAssessmentFilter}
            />
          )
        ) : filteredAccounts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No {isPipeline ? 'open renewals' : 'accounts'} in the selected period. Adjust the fiscal quarter filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead>
                <tr className="border-b">
                  <TableHeader label="Account" field="account" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <TableHeader
                    label="CSE"
                    field="cse"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterOptions={cseOptions}
                    selectedFilters={cseFilter}
                    onFilterChange={setCseFilter}
                  />
                  <TableHeader label="Renewal date" field="renewalDate" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  {isPipeline ? (
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      <span className="inline-flex items-center">
                        Status
                        <MetricHint text="Open = renewal not yet closed. Pushed = past close date, still open." />
                      </span>
                    </th>
                  ) : (
                    <TableHeader label="Outcome" field="outcome" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  )}
                  <TableHeader label="ATR" field="atr" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  {!isPipeline ? (
                    <>
                      <TableHeader label="Renewed" field="renewed" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                      <TableHeader label="Churned ATR" field="churned" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                      <TableHeader label="Downsell" field="downsell" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                    </>
                  ) : (
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Next step</th>
                  )}
                  <TableHeader
                    label={
                      <span className="inline-flex items-center justify-center">
                        Overall Assessment
                        <MetricHint text={RENEWAL_METRIC_HINTS.overallAssessment} />
                      </span>
                    }
                    field="overallAssessment"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterOptions={overallAssessmentOptions}
                    selectedFilters={overallAssessmentFilter}
                    onFilterChange={setOverallAssessmentFilter}
                    align="center"
                  />
                  <TableHeader
                    label={
                      <span className="inline-flex items-center justify-center">
                        Slack
                        <MetricHint text={RENEWAL_METRIC_HINTS.daysSinceSlackUpdate} />
                      </span>
                    }
                    field="slackUpdate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <TableHeader
                    label={
                      <span className="inline-flex items-center justify-center">
                        Engagement
                        <MetricHint text={RENEWAL_METRIC_HINTS.daysSinceCustomerEngagement} />
                      </span>
                    }
                    field="customerEngagement"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  {!isPipeline ? (
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((a) => (
                  <tr key={a.accountId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-2 py-2">
                      <Link href={`/accounts/${a.accountId}`} className="font-medium hover:underline">
                        {a.accountName}
                      </Link>
                      {a.opportunityCount > 1 ? (
                        <span className="ml-1 text-xs text-gray-400">({a.opportunityCount} opps)</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-gray-700">{a.cseName ?? '—'}</td>
                    <td className="px-2 py-2 tabular-nums">{a.renewalDate ?? '—'}</td>
                    <td className="px-2 py-2">
                      {isPipeline ? (
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${a.outcome === 'pushed' ? 'bg-orange-100 text-orange-800' : 'bg-blue-50 text-blue-800'}`}
                        >
                          {prospectivePipelineStatus(a.outcome)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="rounded bg-gray-100 px-2 py-0.5 text-xs hover:bg-gray-200"
                          onClick={() => {
                            const next = new Set(outcomeFilter);
                            if (next.has(a.outcome)) next.delete(a.outcome);
                            else next.add(a.outcome);
                            setOutcomeFilter(next);
                          }}
                        >
                          {OUTCOME_LABELS[a.outcome]}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(a.atrUSD)}</td>
                    {!isPipeline ? (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(a.renewedRevenueUSD)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-red-700">
                          {a.churnedAtrUSD > 0 ? fmtUSD(a.churnedAtrUSD) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                          {a.downsellAmountUSD > 0 ? fmtUSD(a.downsellAmountUSD) : '—'}
                        </td>
                      </>
                    ) : (
                      <td className="max-w-[180px] truncate px-2 py-2 text-gray-600" title={a.nextStep ?? undefined}>
                        {a.nextStep ?? '—'}
                      </td>
                    )}
                    <td className="px-2 py-2 text-center">
                      <OverallAssessmentCell
                        category={a.overallAssessment}
                        detail={a.overallAssessmentDetail}
                        riskScore={a.healthScore}
                        riskBand={a.healthBand}
                        riskConfidence={a.riskScoreConfidence}
                        signals={a.riskSignals}
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <EngagementDaysCell
                        days={a.daysSinceSlackUpdate}
                        lastTouch={a.slackLastTouch}
                        label="Last Slack post"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <EngagementDaysCell
                        days={a.daysSinceCustomerEngagement}
                        lastTouch={a.customerEngagementLastTouch}
                        label="Last customer engagement"
                      />
                    </td>
                    {!isPipeline ? (
                      <td className="max-w-[200px] truncate px-2 py-2 text-gray-600" title={a.reason ?? undefined}>
                        {a.reason ?? '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

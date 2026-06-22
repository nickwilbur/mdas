'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtUSD, RiskScoreBadge, SentimentBadge } from '@/components/ui';
import { LabelWithHint } from '@/components/MetricHint';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import {
  formatGapToPlan,
  fmtSignedUSD,
  GRR_INTERNAL_GOAL,
  GRR_TONE_STYLES,
  grrMeetsInternalGoal,
  planPerformancePctLabel,
  planPerformanceTone,
  PLAN_TONE_STYLES,
} from '@/lib/forecast-plan-kpi';
import { fiscalQuarterLabel } from '@/lib/fiscal';
import { loadChurnPlansByQuarter } from '@/lib/forecast-plan-storage';
import { RENEWAL_DASHBOARD_HINTS } from '@/lib/renewal-metric-tooltips';
import type { CSESentiment } from '@mdas/canonical';
import type {
  QuarterTrendPoint,
  RenewalAccountRow,
  RenewalMetricsSummary,
  RenewalOppRow,
  RenewalOutcome,
} from '@mdas/renewal-metrics';

const OUTCOME_META: Record<
  RenewalOutcome,
  { label: string; color: string; description: string }
> = {
  flat: { label: 'Renewed flat', color: '#10b981', description: 'Renewed ≈ ATR' },
  downsell: { label: 'Downsell', color: '#f59e0b', description: 'Partial retention' },
  full_churn: { label: 'Full churn', color: '#dc2626', description: 'Logo lost' },
  expanded: { label: 'Expanded', color: '#8b5cf6', description: 'Renewed above ATR' },
  pending: { label: 'Pending', color: '#60a5fa', description: 'Open renewal' },
  pushed: { label: 'Pushed', color: '#fb923c', description: 'Past close, still open' },
};

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return fmtUSD(n);
}

function pct(n: number | null, digits = 1): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function opportunityHref(opportunityId: string): string {
  return `/opportunities?focus=${encodeURIComponent(opportunityId)}`;
}

type AttentionSortField =
  | 'account'
  | 'opportunity'
  | 'outcome'
  | 'atr'
  | 'mostLikely'
  | 'renewalDate'
  | 'risk';

function primaryOpp(account: RenewalAccountRow): RenewalOppRow | null {
  if (account.opportunities.length === 0) return null;
  return [...account.opportunities].sort((a, b) => b.atrUSD - a.atrUSD)[0]!;
}

function UpcomingAtrBucket({
  label,
  rows,
}: {
  label: string;
  rows: RenewalAccountRow[];
}) {
  const total = rows.reduce((s, r) => s + r.atrUSD, 0);
  const sorted = [...rows].sort((a, b) => b.atrUSD - a.atrUSD);

  return (
    <div className="group relative rounded-md px-1 py-1 hover:bg-gray-50 focus-within:bg-gray-50">
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 flex items-baseline justify-between">
        <span className="text-2xl font-semibold tabular-nums">{fmtCompact(total)}</span>
        <span className="text-xs text-gray-500">
          {rows.length} account{rows.length === 1 ? '' : 's'}
        </span>
      </dd>
      {sorted.length > 0 ? (
        <div
          className="pointer-events-none absolute bottom-full left-0 right-0 z-30 mb-1 hidden rounded-lg border border-gray-200 bg-white p-3 shadow-lg group-hover:pointer-events-auto group-hover:block group-focus-within:pointer-events-auto group-focus-within:block"
          role="tooltip"
        >
          <p className="mb-2 text-xs font-semibold text-gray-900">{label}</p>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
            {sorted.map((a) => {
              const opp = primaryOpp(a);
              return (
                <li
                  key={a.accountId}
                  className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/accounts/${a.accountId}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {a.accountName}
                    </Link>
                    {opp ? (
                      <Link
                        href={opportunityHref(opp.opportunityId)}
                        className="block truncate text-gray-500 hover:text-blue-700 hover:underline"
                      >
                        {opp.opportunityName}
                      </Link>
                    ) : null}
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-medium">{fmtUSD(a.atrUSD)}</p>
                    <p className="text-gray-500">
                      {opp?.forecastMostLikelyUSD != null
                        ? fmtSignedUSD(opp.forecastMostLikelyUSD)
                        : '—'}{' '}
                      ML
                    </p>
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 text-gray-500">
                    <span>{fmtDate(a.renewalDate)}</span>
                    {a.healthScore != null && a.healthBand ? (
                      <RiskScoreBadge
                        score={a.healthScore}
                        band={a.healthBand as 'Low' | 'Medium' | 'High' | 'Critical'}
                        confidence={a.riskScoreConfidence ?? 'low'}
                      />
                    ) : null}
                    {a.cseSentiment ? (
                      <SentimentBadge value={a.cseSentiment as CSESentiment} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const RISK_ROW_BORDER: Record<string, string> = {
  Critical: 'border-l-red-600',
  High: 'border-l-orange-500',
  Medium: 'border-l-amber-400',
  Low: 'border-l-emerald-500',
};

const PIE_LABEL_MIN_PCT = 0.06;

function OutcomePieLabel({
  cx = 0,
  cy = 0,
  midAngle = 0,
  innerRadius = 0,
  outerRadius = 0,
  percent = 0,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
}) {
  if (percent < PIE_LABEL_MIN_PCT) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const radian = (-midAngle * Math.PI) / 180;
  const x = cx + radius * Math.cos(radian);
  const y = cy + radius * Math.sin(radian);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      {(percent * 100).toFixed(0)}%
    </text>
  );
}

function DeltaBadge({
  current,
  prior,
  invert = false,
  suffix = 'pp',
  isRate = true,
}: {
  current: number | null;
  prior: number | null | undefined;
  invert?: boolean;
  suffix?: string;
  isRate?: boolean;
}) {
  if (current == null || prior == null) return null;
  const delta = isRate ? (current - prior) * 100 : current - prior;
  if (Math.abs(delta) < 0.05) return <span className="text-xs text-gray-500">→ flat vs prior</span>;
  const good = invert ? delta < 0 : delta > 0;
  const sign = delta > 0 ? '+' : '';
  const display = isRate ? `${sign}${delta.toFixed(1)}${suffix}` : `${sign}${fmtCompact(delta)}`;
  return (
    <span className={`text-xs font-medium ${good ? 'text-emerald-700' : 'text-red-700'}`}>
      {display} vs prior quarter
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-gray-900">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="tabular-nums">
          {p.name}: {typeof p.value === 'number' && p.name.includes('%') ? pct(p.value / 100) : fmtCompact(p.value)}
        </p>
      ))}
    </div>
  );
}

export interface RenewalDashboardClientProps {
  metrics: RenewalMetricsSummary;
  trend: QuarterTrendPoint[];
  attentionAccounts: RenewalAccountRow[];
  atRisk30: RenewalAccountRow[];
  atRisk60: RenewalAccountRow[];
  atRisk90: RenewalAccountRow[];
  quarterLabel: string;
  selectedQuarterKey: string | null;
  /** First quarter key on the retention trend chart (rolling history start). */
  trendStartKey: string;
  /** Churn/Downsell Flash for the selected quarter (single-quarter view only). */
  quarterFlashUSD?: number | null;
}

export function RenewalDashboardClient({
  metrics,
  trend,
  attentionAccounts,
  atRisk30,
  atRisk60,
  atRisk90,
  quarterLabel,
  selectedQuarterKey,
  trendStartKey,
  quarterFlashUSD = null,
}: RenewalDashboardClientProps) {
  const prior = metrics.priorPeriod;
  const grr = metrics.grossRevenueRetentionPct;
  const grrTone = grrMeetsInternalGoal(grr) ? GRR_TONE_STYLES.green : GRR_TONE_STYLES.belowGoal;

  const [planUSD, setPlanUSD] = useState<number | null>(null);
  useEffect(() => {
    if (!selectedQuarterKey) {
      setPlanUSD(null);
      return;
    }
    const plans = loadChurnPlansByQuarter();
    setPlanUSD(plans[selectedQuarterKey] ?? null);
  }, [selectedQuarterKey]);

  const showPlanCard = selectedQuarterKey != null && quarterFlashUSD != null;
  const planTone = showPlanCard ? planPerformanceTone(quarterFlashUSD, planUSD) : null;
  const planPctLabel =
    showPlanCard && planUSD != null ? planPerformancePctLabel(quarterFlashUSD, planUSD) : null;
  const planStyles = planTone ? PLAN_TONE_STYLES[planTone] : PLAN_TONE_STYLES.neutral;

  const outcomeData = (
    Object.entries(metrics.outcomeCounts) as [RenewalOutcome, number][]
  )
    .filter(([, n]) => n > 0)
    .map(([outcome, count]) => ({
      name: OUTCOME_META[outcome].label,
      value: count,
      outcome,
      color: OUTCOME_META[outcome].color,
    }));

  const bridgeData = [
    { name: 'Starting ATR', value: metrics.bridge.startingAtrUSD, fill: '#64748b' },
    { name: 'Full churn', value: -metrics.bridge.fullChurnUSD, fill: '#dc2626' },
    { name: 'Downsell', value: -metrics.bridge.downsellUSD, fill: '#f59e0b' },
    { name: 'Expansion', value: metrics.bridge.expansionUSD, fill: '#8b5cf6' },
    { name: 'Renewed', value: metrics.bridge.endingRenewedUSD, fill: '#059669' },
  ];

  const comparisonData = [
    {
      name: 'Portfolio',
      atr: metrics.atrUpForRenewalUSD,
      renewed: metrics.renewedRevenueUSD,
      churned: metrics.atrChurnedUSD,
      downsell: metrics.downsellAmountUSD,
    },
  ];

  const trendChartData = trend.map((t) => ({
    quarter: t.quarterLabel.replace(' ', '\n'),
    grr: t.grossRevenueRetentionPct != null ? t.grossRevenueRetentionPct * 100 : null,
    atr: t.atrUpForRenewalUSD,
    renewed: t.renewedRevenueUSD,
    accounts: t.accountsUpForRenewal,
  }));

  const [attentionSortField, setAttentionSortField] = useState<AttentionSortField>('atr');
  const [attentionSortDirection, setAttentionSortDirection] = useState<SortDirection>('desc');

  const sortedAttentionAccounts = useMemo(() => {
    const rows = [...attentionAccounts];
    const dir = attentionSortDirection === 'asc' ? 1 : -1;
    const cmp = (a: number | string | null, b: number | string | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (a < b) return -1 * dir;
      if (a > b) return 1 * dir;
      return 0;
    };
    rows.sort((a, b) => {
      const oppA = primaryOpp(a);
      const oppB = primaryOpp(b);
      switch (attentionSortField) {
        case 'account':
          return cmp(a.accountName, b.accountName);
        case 'opportunity':
          return cmp(oppA?.opportunityName ?? null, oppB?.opportunityName ?? null);
        case 'outcome':
          return cmp(a.outcome, b.outcome);
        case 'mostLikely':
          return cmp(oppA?.forecastMostLikelyUSD ?? null, oppB?.forecastMostLikelyUSD ?? null);
        case 'renewalDate':
          return cmp(
            a.renewalDate ? Date.parse(a.renewalDate) : null,
            b.renewalDate ? Date.parse(b.renewalDate) : null,
          );
        case 'risk':
          return cmp(a.healthScore, b.healthScore);
        case 'atr':
        default:
          return cmp(a.atrUSD, b.atrUSD);
      }
    });
    return rows;
  }, [attentionAccounts, attentionSortField, attentionSortDirection]);

  const handleAttentionSort = (field: AttentionSortField) => {
    if (attentionSortField === field) {
      setAttentionSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setAttentionSortField(field);
      setAttentionSortDirection(field === 'account' || field === 'opportunity' ? 'asc' : 'desc');
    }
  };

  const attentionHeader = {
    sortField: attentionSortField,
    sortDirection: attentionSortDirection,
    onSort: handleAttentionSort,
  };

  const drilldownHref = (outcome?: RenewalOutcome, knownChurn = false) => {
    const params = new URLSearchParams();
    params.set('view', outcome || knownChurn ? 'quarter-close' : 'pipeline');
    if (selectedQuarterKey) params.set('quarters', selectedQuarterKey);
    if (outcome) params.set('outcome', outcome);
    if (knownChurn) params.set('knownChurn', '1');
    return `/renewal-analysis?${params.toString()}`;
  };

  return (
    <div className="space-y-8">
      {/* Context banner — answers "what am I looking at?" immediately */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Renewal portfolio · {quarterLabel}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {metrics.accountsUpForRenewal} accounts ·{' '}
              {fmtUSD(metrics.atrUpForRenewalUSD)} ATR up for renewal
            </p>
          </div>
          <Link
            href={drilldownHref()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Open workbench →
          </Link>
        </div>
      </div>

      {/* Hero KPI — GRR north star + optional plan card (single quarter only) */}
      <section aria-labelledby="hero-grr">
        <div
          className={`grid grid-cols-1 gap-4 ${showPlanCard ? 'lg:grid-cols-12' : 'lg:grid-cols-12'}`}
        >
          <div
            className={`rounded-xl border p-6 ${grrTone.border} ${grrTone.bg} ${showPlanCard ? 'lg:col-span-4' : 'lg:col-span-4'}`}
          >
            <h2 id="hero-grr" className={`text-sm font-medium ${grrTone.title}`}>
              <LabelWithHint label="Gross renewal retention" hint={RENEWAL_DASHBOARD_HINTS.grr} />
            </h2>
            <p className={`mt-2 text-5xl font-bold tabular-nums tracking-tight ${grrTone.value}`}>
              {pct(grr, 1)}
            </p>
            <p className={`mt-2 text-sm ${grrTone.sub}`}>
              {fmtUSD(metrics.renewedRevenueUSD)} renewed of {fmtUSD(metrics.atrUpForRenewalUSD)} ATR
            </p>
            <div className="mt-2">
              <DeltaBadge current={grr} prior={prior?.grossRevenueRetentionPct} />
            </div>
            <p
              className={`mt-3 text-xs ${grrTone.hint}`}
              title={`Internal goal: ${(GRR_INTERNAL_GOAL * 100).toFixed(0)}%+. Derived renewed revenue ÷ ATR.`}
            >
              Goal {(GRR_INTERNAL_GOAL * 100).toFixed(0)}%+ · saveable book excludes confirmed full
              churn
            </p>
          </div>

          {showPlanCard ? (
            <div
              className={`rounded-xl border p-6 lg:col-span-4 ${planStyles.border} ${planStyles.bg}`}
              aria-labelledby="hero-plan"
            >
              <h2 id="hero-plan" className={`text-sm font-medium ${planStyles.text}`}>
                <LabelWithHint
                  label="Churn / downsell vs plan"
                  hint={RENEWAL_DASHBOARD_HINTS.planVsFlash}
                />
              </h2>
              <p className={`mt-1 text-xs ${planStyles.sub}`}>
                Same Flash &amp; Plan as the{' '}
                <Link href="/forecast" className="underline hover:no-underline">
                  weekly forecast
                </Link>
                {' '}for {quarterLabel}
              </p>
              <dl className={`mt-4 space-y-2 text-sm ${planStyles.sub}`}>
                <div className="flex justify-between gap-4">
                  <dt>Plan</dt>
                  <dd className={`font-semibold tabular-nums ${planStyles.text}`}>
                    {planUSD != null ? fmtSignedUSD(planUSD) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Flash</dt>
                  <dd className={`font-semibold tabular-nums ${planStyles.text}`}>
                    {fmtSignedUSD(quarterFlashUSD)}
                  </dd>
                </div>
              </dl>
              {planUSD != null ? (
                <p className={`mt-4 text-lg font-semibold tabular-nums ${planStyles.text}`}>
                  {planPctLabel ?? formatGapToPlan(quarterFlashUSD, planUSD)}
                </p>
              ) : (
                <p className={`mt-4 text-sm ${planStyles.sub}`}>
                  No plan saved for this quarter — set it on the{' '}
                  <Link href="/forecast" className="font-medium underline hover:no-underline">
                    Forecast
                  </Link>{' '}
                  page (persists in this browser).
                </p>
              )}
            </div>
          ) : null}

          {/* Secondary KPIs — scannable grid, consistent hierarchy */}
          <div
            className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${showPlanCard ? 'lg:col-span-4' : 'lg:col-span-8'}`}
          >
            {[
              {
                label: 'ATR at risk',
                hint: RENEWAL_DASHBOARD_HINTS.atrUp,
                value: fmtCompact(metrics.atrUpForRenewalUSD),
                sub: `${metrics.accountsUpForRenewal} accounts`,
                delta: prior ? fmtCompact(metrics.atrUpForRenewalUSD - prior.atrUpForRenewalUSD) : null,
              },
              {
                label: 'ATR churned',
                hint: RENEWAL_DASHBOARD_HINTS.atrChurned,
                value: fmtCompact(metrics.atrChurnedUSD),
                sub: pct(metrics.atrChurnedUSD / Math.max(metrics.atrUpForRenewalUSD, 1)) + ' of ATR',
                delta: prior ? fmtCompact(metrics.atrChurnedUSD - prior.atrChurnedUSD) : null,
                warn: true,
              },
              {
                label: 'Logo churn',
                hint: RENEWAL_DASHBOARD_HINTS.logoChurn,
                value: pct(metrics.fullLogoChurnRate),
                sub: `${metrics.fullChurnAccountCount} accounts`,
                delta: prior && metrics.fullLogoChurnRate != null && prior.fullLogoChurnRate != null
                  ? `${((metrics.fullLogoChurnRate - prior.fullLogoChurnRate) * 100).toFixed(1)}pp`
                  : null,
                warn: true,
              },
              {
                label: 'Downsell exposure',
                hint: RENEWAL_DASHBOARD_HINTS.downsellExposure,
                value: fmtCompact(metrics.downsellAmountUSD),
                sub: `${metrics.downsellAccountCount} accounts (${pct(metrics.downsellAccountRate, 0)})`,
                delta: prior ? fmtCompact(metrics.downsellAmountUSD - prior.downsellAmountUSD) : null,
                warn: true,
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  <LabelWithHint label={kpi.label} hint={kpi.hint} />
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums ${kpi.warn ? 'text-gray-900' : 'text-gray-900'}`}
                >
                  {kpi.value}
                </p>
                <p className="mt-1 text-xs text-gray-500">{kpi.sub}</p>
                {kpi.delta ? (
                  <p className="mt-1 text-xs text-gray-400">{kpi.delta} vs prior</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Known churn — SFDC-flagged exits, excluded from saveable renewal KPIs above */}
      <section aria-labelledby="known-churn-heading">
        <Link
          href={drilldownHref(undefined, true)}
          className="block rounded-xl border-2 border-gray-900 bg-gray-50 p-5 shadow-sm transition hover:border-gray-700 hover:bg-gray-100"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="known-churn-heading" className="text-sm font-semibold text-gray-900">
                <LabelWithHint label="Known churn" hint={RENEWAL_DASHBOARD_HINTS.knownChurn} />
              </h2>
              <p className="mt-1 text-xs text-gray-600">
                Renewal opps with SFDC Churn Risk = <strong>Confirmed Full Churn</strong> —
                excluded from GRR, downsell, and saveable ATR above
              </p>
            </div>
            <span className="text-xs font-medium text-blue-700">View details →</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Accounts</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {metrics.knownChurn.accountCount}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Opportunities</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {metrics.knownChurn.opportunityCount}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">ATR on opps</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {fmtCompact(metrics.knownChurn.atrUSD)}
              </p>
              {prior ? (
                <p className="mt-1 text-xs text-gray-500">
                  {fmtCompact(metrics.knownChurn.atrUSD - prior.knownChurn.atrUSD)} vs prior qtr
                </p>
              ) : null}
            </div>
          </div>
        </Link>
      </section>

      {/* Trends + composition — compare over time before drilling down */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-7">
          <h3 className="text-sm font-semibold text-gray-900">
            <LabelWithHint label="Retention trend by quarter" hint={RENEWAL_DASHBOARD_HINTS.retentionTrend} />
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {fiscalQuarterLabel(trendStartKey)} through{' '}
            {fiscalQuarterLabel(trend[trend.length - 1]?.quarterKey ?? trendStartKey)} — last{' '}
            {trend.length} quarters
          </p>
          <div className="mt-4 h-72 min-h-[288px] w-full min-w-0" role="img" aria-label="Retention trend chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <ComposedChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="quarter" tick={{ fontSize: 11 }} interval={0} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtCompact(v)}
                  width={56}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  domain={[0, 100]}
                  width={40}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="renewed" name="Renewed $" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="atr" name="ATR $" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="grr"
                  name="GRR %"
                  stroke={grrMeetsInternalGoal(grr) ? '#047857' : '#d97706'}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <ReferenceLine
                  yAxisId="right"
                  y={GRR_INTERNAL_GOAL * 100}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{
                    value: `${GRR_INTERNAL_GOAL * 100}% goal`,
                    position: 'insideTopRight',
                    fill: '#64748b',
                    fontSize: 10,
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-5">
          <h3 className="text-sm font-semibold text-gray-900">
            <LabelWithHint label="Outcome mix" hint={RENEWAL_DASHBOARD_HINTS.outcomeMix} />
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Share of accounts by renewal result</p>
          <div className="mt-4 h-72 min-h-[288px] w-full min-w-0" role="img" aria-label="Outcome distribution chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <PieChart>
                <Pie
                  data={outcomeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  label={OutcomePieLabel}
                  labelLine={false}
                >
                  {outcomeData.map((entry) => (
                    <Cell key={entry.outcome} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const n = typeof value === 'number' ? value : 0;
                    return [
                      `${n} accounts (${pct(n / Math.max(metrics.accountsUpForRenewal, 1), 0)})`,
                      String(name ?? ''),
                    ];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
            {outcomeData.map((o) => (
              <li key={o.outcome}>
                <Link
                  href={drilldownHref(o.outcome)}
                  className="text-blue-700 hover:underline"
                >
                  {o.name} ({o.value} ·{' '}
                  {pct(o.value / Math.max(metrics.accountsUpForRenewal, 1), 0)})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Revenue bridge + comparison — where losses come from */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">
            <LabelWithHint label="Revenue bridge" hint={RENEWAL_DASHBOARD_HINTS.revenueBridge} />
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">ATR → churn → downsell → expansion → renewed</p>
          <div className="mt-4 h-64 min-h-[256px] w-full min-w-0" role="img" aria-label="Revenue bridge waterfall">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <BarChart data={bridgeData} layout="vertical" margin={{ left: 80, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtCompact(Math.abs(v))} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={76} />
                <Tooltip
                  formatter={(value) =>
                    fmtCompact(Math.abs(typeof value === 'number' ? value : 0))
                  }
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {bridgeData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">
            <LabelWithHint
              label="Portfolio snapshot"
              hint={RENEWAL_DASHBOARD_HINTS.portfolioSnapshot}
            />
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Side-by-side ATR components for selected period</p>
          <div className="mt-4 h-64 min-h-[256px] w-full min-w-0" role="img" aria-label="ATR comparison chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <BarChart data={comparisonData} margin={{ top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11 }} width={56} />
                <Tooltip
                  formatter={(value) =>
                    fmtCompact(typeof value === 'number' ? value : 0)
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="atr" name="ATR up" fill="#64748b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="renewed" name="Renewed" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="churned" name="Churned" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Bar dataKey="downsell" name="Downsell" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Action-oriented bottom — who needs attention, not a full spreadsheet */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-red-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                <LabelWithHint
                  label="Accounts needing attention"
                  hint={RENEWAL_DASHBOARD_HINTS.attentionAccounts}
                />
              </h3>
              <p className="text-xs text-gray-500">
                Highest ATR among churn, downsell, pushed, and open renewals
              </p>
            </div>
            <Link href={drilldownHref()} className="text-xs text-blue-700 hover:underline">
              View all →
            </Link>
          </div>
          {sortedAttentionAccounts.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No at-risk accounts in this period.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <TableHeader<AttentionSortField>
                      {...attentionHeader}
                      label="Account"
                      field="account"
                    />
                    <TableHeader<AttentionSortField>
                      {...attentionHeader}
                      label="Opportunity"
                      field="opportunity"
                    />
                    <th className="px-3 py-2 text-left font-normal">Risk / sentiment</th>
                    <TableHeader<AttentionSortField>
                      {...attentionHeader}
                      label="ATR"
                      field="atr"
                      align="right"
                    />
                    <TableHeader<AttentionSortField>
                      {...attentionHeader}
                      label="Most likely"
                      field="mostLikely"
                      align="right"
                    />
                    <TableHeader<AttentionSortField>
                      {...attentionHeader}
                      label="Renewal date"
                      field="renewalDate"
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedAttentionAccounts.map((a) => {
                    const opp = primaryOpp(a);
                    const riskBand = a.healthBand ?? 'Unknown';
                    const borderClass = RISK_ROW_BORDER[riskBand] ?? 'border-l-gray-300';
                    return (
                      <tr
                        key={a.accountId}
                        className={`border-t border-gray-100 border-l-4 ${borderClass}`}
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/accounts/${a.accountId}`}
                            className="font-medium hover:underline"
                          >
                            {a.accountName}
                          </Link>
                          <p className="text-xs text-gray-500">
                            {a.cseName ?? 'No CSE'} · {OUTCOME_META[a.outcome].label}
                          </p>
                        </td>
                        <td className="max-w-[12rem] px-3 py-2.5">
                          {opp ? (
                            <Link
                              href={opportunityHref(opp.opportunityId)}
                              className="block truncate text-blue-700 hover:underline"
                              title={opp.opportunityName}
                            >
                              {opp.opportunityName}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {a.healthScore != null && a.healthBand ? (
                              <RiskScoreBadge
                                score={a.healthScore}
                                band={a.healthBand as 'Low' | 'Medium' | 'High' | 'Critical'}
                                confidence={a.riskScoreConfidence ?? 'low'}
                              />
                            ) : null}
                            {a.cseSentiment ? (
                              <SentimentBadge value={a.cseSentiment as CSESentiment} />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                          {fmtUSD(a.atrUSD)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {opp?.forecastMostLikelyUSD != null
                            ? fmtSignedUSD(opp.forecastMostLikelyUSD)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-700">
                          {fmtDate(a.renewalDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">
            <LabelWithHint
              label="Upcoming renewal ATR"
              hint={RENEWAL_DASHBOARD_HINTS.upcomingAtr}
            />
          </h3>
          <p className="text-xs text-gray-500">Hover a bucket to see accounts · open pipeline by close window</p>
          <dl className="mt-4 space-y-4">
            <UpcomingAtrBucket label="Next 30 days" rows={atRisk30} />
            <UpcomingAtrBucket label="31–60 days" rows={atRisk60} />
            <UpcomingAtrBucket label="61–90 days" rows={atRisk90} />
          </dl>
        </div>
      </section>
    </div>
  );
}

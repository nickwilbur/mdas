'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
import { fmtUSD } from '@/components/ui';
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
import { loadChurnPlansByQuarter } from '@/lib/forecast-plan-storage';
import type {
  QuarterTrendPoint,
  RenewalAccountRow,
  RenewalMetricsSummary,
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

  const drilldownHref = (outcome?: RenewalOutcome, knownChurn = false) => {
    const params = new URLSearchParams();
    if (selectedQuarterKey) params.set('quarters', selectedQuarterKey);
    if (outcome) params.set('outcome', outcome);
    if (knownChurn) params.set('knownChurn', '1');
    const q = params.toString();
    return `/renewal-analysis${q ? `?${q}` : ''}`;
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
            Open account analysis →
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
              Gross renewal retention
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
                Churn / downsell vs plan
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
                value: fmtCompact(metrics.atrUpForRenewalUSD),
                sub: `${metrics.accountsUpForRenewal} accounts`,
                delta: prior ? fmtCompact(metrics.atrUpForRenewalUSD - prior.atrUpForRenewalUSD) : null,
              },
              {
                label: 'ATR churned',
                value: fmtCompact(metrics.atrChurnedUSD),
                sub: pct(metrics.atrChurnedUSD / Math.max(metrics.atrUpForRenewalUSD, 1)) + ' of ATR',
                delta: prior ? fmtCompact(metrics.atrChurnedUSD - prior.atrChurnedUSD) : null,
                warn: true,
              },
              {
                label: 'Logo churn',
                value: pct(metrics.fullLogoChurnRate),
                sub: `${metrics.fullChurnAccountCount} accounts`,
                delta: prior && metrics.fullLogoChurnRate != null && prior.fullLogoChurnRate != null
                  ? `${((metrics.fullLogoChurnRate - prior.fullLogoChurnRate) * 100).toFixed(1)}pp`
                  : null,
                warn: true,
              },
              {
                label: 'Downsell exposure',
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
                  {kpi.label}
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
                Known churn
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
          <h3 className="text-sm font-semibold text-gray-900">Retention trend by quarter</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            FY26 Q1 through {quarterLabel} — each quarter evaluated as-of its close (or today for
            the open quarter)
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
          <h3 className="text-sm font-semibold text-gray-900">Outcome mix</h3>
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
                >
                  {outcomeData.map((entry) => (
                    <Cell key={entry.outcome} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${value} accounts (${pct(value / metrics.accountsUpForRenewal, 0)})`,
                    name,
                  ]}
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
                  {o.name} ({o.value})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Revenue bridge + comparison — where losses come from */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Revenue bridge</h3>
          <p className="mt-0.5 text-xs text-gray-500">ATR → churn → downsell → expansion → renewed</p>
          <div className="mt-4 h-64 min-h-[256px] w-full min-w-0" role="img" aria-label="Revenue bridge waterfall">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <BarChart data={bridgeData} layout="vertical" margin={{ left: 80, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtCompact(Math.abs(v))} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={76} />
                <Tooltip formatter={(v: number) => fmtCompact(Math.abs(v))} />
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
          <h3 className="text-sm font-semibold text-gray-900">Portfolio snapshot</h3>
          <p className="mt-0.5 text-xs text-gray-500">Side-by-side ATR components for selected period</p>
          <div className="mt-4 h-64 min-h-[256px] w-full min-w-0" role="img" aria-label="ATR comparison chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <BarChart data={comparisonData} margin={{ top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11 }} width={56} />
                <Tooltip formatter={(v: number) => fmtCompact(v)} />
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
              <h3 className="text-sm font-semibold text-gray-900">Accounts needing attention</h3>
              <p className="text-xs text-gray-500">
                Highest ATR among churn, downsell, and pushed renewals
              </p>
            </div>
            <Link href={drilldownHref()} className="text-xs text-blue-700 hover:underline">
              View all →
            </Link>
          </div>
          {attentionAccounts.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No at-risk accounts in this period.</p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {attentionAccounts.slice(0, 8).map((a) => (
                <li key={a.accountId} className="flex items-center gap-3 py-3">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: OUTCOME_META[a.outcome].color }}
                    title={OUTCOME_META[a.outcome].label}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/accounts/${a.accountId}`}
                      className="truncate font-medium hover:underline"
                    >
                      {a.accountName}
                    </Link>
                    <p className="truncate text-xs text-gray-500">
                      {a.cseName ?? 'No CSE'} · {OUTCOME_META[a.outcome].label}
                      {a.reason ? ` · ${a.reason.slice(0, 60)}` : ''}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-medium">{fmtUSD(a.atrUSD)}</p>
                    <p className="text-xs text-gray-500">ATR</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Upcoming renewal ATR</h3>
          <p className="text-xs text-gray-500">Open pipeline by close window</p>
          <dl className="mt-4 space-y-4">
            {[
              { label: 'Next 30 days', rows: atRisk30, horizon: 30 },
              { label: '31–60 days', rows: atRisk60, horizon: 60 },
              { label: '61–90 days', rows: atRisk90, horizon: 90 },
            ].map(({ label, rows, horizon }) => (
              <div key={horizon}>
                <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
                <dd className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">
                    {fmtCompact(rows.reduce((s, r) => s + r.atrUSD, 0))}
                  </span>
                  <span className="text-xs text-gray-500">{rows.length} accounts</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}

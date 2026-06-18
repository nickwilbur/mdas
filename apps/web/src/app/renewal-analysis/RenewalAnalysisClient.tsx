'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Card,
  fmtUSD,
  RiskScoreBadge,
  StatTile,
} from '@/components/ui';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import type {
  KnownChurnOppRow,
  RenewalAccountRow,
  RenewalMetricsSummary,
  RenewalOutcome,
} from '@mdas/renewal-metrics';

const OUTCOME_LABELS: Record<RenewalOutcome, string> = {
  flat: 'Renewed flat',
  downsell: 'Downsell',
  full_churn: 'Full churn',
  expanded: 'Expanded',
  pending: 'Pending',
  pushed: 'Pushed / delayed',
};

const OUTCOME_COLORS: Record<RenewalOutcome, string> = {
  flat: 'bg-emerald-500',
  downsell: 'bg-amber-500',
  full_churn: 'bg-red-600',
  expanded: 'bg-violet-500',
  pending: 'bg-blue-400',
  pushed: 'bg-orange-400',
};

type SortField =
  | 'account'
  | 'cse'
  | 'renewalDate'
  | 'atr'
  | 'renewed'
  | 'churned'
  | 'downsell'
  | 'outcome'
  | 'health';

type KpiFilter =
  | 'all'
  | 'atr_up'
  | 'renewed'
  | 'churned'
  | 'full_churn_rate'
  | 'downsell_rate'
  | 'grr'
  | 'known_churn';

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

function OutcomeBreakdown({ counts }: { counts: RenewalMetricsSummary['outcomeCounts'] }) {
  const entries = (Object.entries(counts) as [RenewalOutcome, number][]).filter(
    ([, n]) => n > 0,
  );
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded">
        {entries.map(([outcome, count]) => (
          <div
            key={outcome}
            className={OUTCOME_COLORS[outcome]}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${OUTCOME_LABELS[outcome]}: ${count}`}
          />
        ))}
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
  rows,
}: {
  title: string;
  rows: { reason: string; accountCount: number; atrUSD: number }[];
}) {
  if (rows.length === 0) {
    return (
      <Card title={title}>
        <p className="text-sm text-gray-500">No reasons recorded in scope.</p>
      </Card>
    );
  }
  return (
    <Card title={title}>
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
    </Card>
  );
}

export interface RenewalAnalysisClientProps {
  metrics: RenewalMetricsSummary;
  accounts: RenewalAccountRow[];
  knownChurnRows: KnownChurnOppRow[];
  atRisk30: RenewalAccountRow[];
  quarterLabel: string;
  /** Pre-filter from dashboard drill-through (?outcome=) */
  initialOutcomeFilter?: string | null;
  /** Pre-filter known churn drill-through (?knownChurn=1) */
  initialKnownChurn?: boolean;
}

export function RenewalAnalysisClient({
  metrics,
  accounts,
  knownChurnRows,
  atRisk30,
  quarterLabel,
  initialOutcomeFilter,
  initialKnownChurn = false,
}: RenewalAnalysisClientProps) {
  const validOutcomes = new Set<string>([
    'flat',
    'downsell',
    'full_churn',
    'expanded',
    'pending',
    'pushed',
  ]);
  const initialOutcome =
    initialOutcomeFilter && validOutcomes.has(initialOutcomeFilter)
      ? (initialOutcomeFilter as RenewalOutcome)
      : null;

  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(
    initialKnownChurn ? 'known_churn' : 'all',
  );
  const [outcomeFilter, setOutcomeFilter] = useState<Set<RenewalOutcome>>(
    () => (initialOutcome ? new Set([initialOutcome]) : new Set()),
  );
  const [cseFilter, setCseFilter] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('atr');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const cseOptions = useMemo(() => {
    const names = new Set<string>();
    for (const a of accounts) {
      if (a.cseName) names.add(a.cseName);
    }
    return Array.from(names).sort().map((n) => ({ value: n, label: n }));
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    let rows = accounts;
    if (kpiFilter === 'churned' || kpiFilter === 'full_churn_rate') {
      rows = rows.filter((a) => a.outcome === 'full_churn');
    } else if (kpiFilter === 'downsell_rate') {
      rows = rows.filter((a) => a.outcome === 'downsell');
    }
    if (outcomeFilter.size > 0) {
      rows = rows.filter((a) => outcomeFilter.has(a.outcome));
    }
    if (cseFilter.size > 0) {
      rows = rows.filter((a) => a.cseName && cseFilter.has(a.cseName));
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
        default:
          return cmp(a.atrUSD, b.atrUSD);
      }
    });
  }, [accounts, kpiFilter, outcomeFilter, cseFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const prior = metrics.priorPeriod;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Detailed account drilldown for <strong>{quarterLabel}</strong>. For the executive summary,
        see the{' '}
        <Link href="/renewals" className="text-blue-700 hover:underline">
          Renewal dashboard
        </Link>
        . ATR uses <code className="text-xs">availableToRenewUSD</code>; saveable metrics exclude
        opps with Churn Risk = <strong>Confirmed Full Churn</strong> (see Known churn card).
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatTile
          label="ATR up for renewal"
          value={fmtUSD(metrics.atrUpForRenewalUSD)}
          sub={deltaLabel(metrics.atrUpForRenewalUSD, prior?.atrUpForRenewalUSD)}
          title="Sum of Available to Renew on saveable renewal opps. Excludes known churn."
          onClick={() => setKpiFilter(kpiFilter === 'atr_up' ? 'all' : 'atr_up')}
          active={kpiFilter === 'atr_up'}
        />
        <StatTile
          label="Renewed revenue"
          value={fmtUSD(metrics.renewedRevenueUSD)}
          sub={
            metrics.atrUpForRenewalUSD > 0
              ? `${pct(metrics.grossRevenueRetentionPct)} of ATR`
              : deltaLabel(metrics.renewedRevenueUSD, prior?.renewedRevenueUSD)
          }
          title="Derived post-renewal dollars: closed-won ACV or ATR + ACV delta; open renewals use manager ML override / forecast as signed delta on ATR."
          onClick={() => setKpiFilter(kpiFilter === 'renewed' ? 'all' : 'renewed')}
          active={kpiFilter === 'renewed'}
        />
        <StatTile
          label="ATR churned"
          value={fmtUSD(metrics.atrChurnedUSD)}
          sub={
            metrics.atrUpForRenewalUSD > 0
              ? `${pct(metrics.atrChurnedUSD / metrics.atrUpForRenewalUSD)} of ATR`
              : deltaLabel(metrics.atrChurnedUSD, prior?.atrChurnedUSD, true)
          }
          title="ATR on accounts/opportunities classified as full churn (renewed revenue = 0). Mutually exclusive with downsell."
          onClick={() => setKpiFilter(kpiFilter === 'churned' ? 'all' : 'churned')}
          active={kpiFilter === 'churned'}
        />
        <StatTile
          label="Full logo churn rate"
          value={pct(metrics.fullLogoChurnRate)}
          sub={`${metrics.fullChurnAccountCount} / ${metrics.accountsUpForRenewal} accounts`}
          title="Fully churned accounts ÷ accounts with renewal ATR in scope. Full churn = renewed revenue is zero or renewal lost."
          onClick={() => setKpiFilter(kpiFilter === 'full_churn_rate' ? 'all' : 'full_churn_rate')}
          active={kpiFilter === 'full_churn_rate'}
        />
        <StatTile
          label="Downsell account rate"
          value={pct(metrics.downsellAccountRate)}
          sub={`${metrics.downsellAccountCount} accts · ${fmtUSD(metrics.downsellAmountUSD)}`}
          title="Accounts where renewed revenue > 0 but < ATR, divided by accounts up for renewal. Downsell $ = ATR − renewed."
          onClick={() => setKpiFilter(kpiFilter === 'downsell_rate' ? 'all' : 'downsell_rate')}
          active={kpiFilter === 'downsell_rate'}
        />
        <StatTile
          label="Renewal retention (GRR)"
          value={pct(metrics.grossRevenueRetentionPct)}
          sub="Renewed ÷ ATR (expansion included in numerator)"
          title="Gross revenue retention: total derived renewed revenue divided by total ATR up for renewal. Expansion on renewal lines increases the numerator."
          onClick={() => setKpiFilter(kpiFilter === 'grr' ? 'all' : 'grr')}
          active={kpiFilter === 'grr'}
        />
        <StatTile
          label="Known churn"
          value={fmtUSD(metrics.knownChurn.atrUSD)}
          sub={`${metrics.knownChurn.accountCount} accts · ${metrics.knownChurn.opportunityCount} opps`}
          title="Renewal opps with SFDC Churn Risk = Confirmed Full Churn. Tracked separately from saveable renewal metrics."
          onClick={() => setKpiFilter(kpiFilter === 'known_churn' ? 'all' : 'known_churn')}
          active={kpiFilter === 'known_churn'}
        />
      </div>

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
        <Card title="Renewal outcome breakdown">
          <OutcomeBreakdown counts={metrics.outcomeCounts} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReasonTable title="Top churn reasons (by ATR)" rows={metrics.topChurnReasonsByAtr} />
        <ReasonTable title="Top downsell reasons (by ATR)" rows={metrics.topDownsellReasonsByAtr} />
      </div>

      {atRisk30.length > 0 ? (
        <Card title={`At-risk pipeline — next 30 days (${atRisk30.length})`}>
          <p className="mb-3 text-xs text-gray-500">
            Upcoming renewals with elevated risk score (≥50), low engagement, missing next step, or
            pushed close date.
          </p>
          <ul className="space-y-2 text-sm">
            {atRisk30.slice(0, 10).map((a) => (
              <li key={a.accountId} className="flex items-center justify-between gap-2">
                <Link href={`/accounts/${a.accountId}`} className="font-medium hover:underline">
                  {a.accountName}
                </Link>
                <span className="tabular-nums text-gray-600">{fmtUSD(a.atrUSD)} ATR</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title={
          kpiFilter === 'known_churn'
            ? `Known churn drilldown (${knownChurnRows.length})`
            : `Renewal drilldown (${filteredAccounts.length}${filteredAccounts.length !== accounts.length ? ` of ${accounts.length}` : ''})`
        }
      >
        {kpiFilter === 'known_churn' ? (
          knownChurnRows.length === 0 ? (
            <p className="text-sm text-gray-500">
              No known-churn renewal opportunities in the selected period. Adjust the fiscal quarter
              filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Account
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Opportunity
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      CSE
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Close date
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Stage
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium uppercase text-gray-500">
                      ATR
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Churn risk
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Reason
                    </th>
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
                      <td className="px-2 py-2">
                        {r.salesforceUrl ? (
                          <a
                            href={r.salesforceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {r.opportunityName}
                          </a>
                        ) : (
                          r.opportunityName
                        )}
                      </td>
                      <td className="px-2 py-2 text-gray-700">{r.cseName ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{r.closeDate ?? '—'}</td>
                      <td className="px-2 py-2 text-gray-700">{r.stageName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(r.atrUSD)}</td>
                      <td className="px-2 py-2 text-gray-700">{r.churnRisk}</td>
                      <td className="max-w-[200px] truncate px-2 py-2 text-gray-600" title={r.reason ?? undefined}>
                        {r.reason ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : accounts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No renewal opportunities with ATR in the selected period. Adjust the fiscal quarter filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
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
                  <TableHeader label="Outcome" field="outcome" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <TableHeader label="ATR" field="atr" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <TableHeader label="Renewed" field="renewed" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <TableHeader label="Churned ATR" field="churned" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <TableHeader label="Downsell" field="downsell" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="right" />
                  <TableHeader label="Health" field="health" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} align="center" />
                  <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Reason</th>
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
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(a.atrUSD)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(a.renewedRevenueUSD)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-red-700">
                      {a.churnedAtrUSD > 0 ? fmtUSD(a.churnedAtrUSD) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                      {a.downsellAmountUSD > 0 ? (
                        <>
                          {fmtUSD(a.downsellAmountUSD)}
                          {a.downsellPct != null ? (
                            <span className="ml-1 text-xs">({a.downsellPct.toFixed(0)}%)</span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {a.healthScore != null && a.healthBand ? (
                        <RiskScoreBadge
                          score={a.healthScore}
                          band={a.healthBand as 'Low' | 'Medium' | 'High' | 'Critical'}
                          confidence="high"
                        />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2 text-gray-600" title={a.reason ?? undefined}>
                      {a.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

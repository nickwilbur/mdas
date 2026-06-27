'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { MarkdownDocument } from '@/components/MarkdownDocument';
import {
  normalizeProgress,
  normalizeStatus,
  parseLeadershipReport,
  type HealthAreaRow,
  type LeadershipReportData,
  type ParsedTable,
} from '@/lib/leadership/parse-report';
import { toExecDashboardData } from '@/lib/leadership/exec-filter';
import {
  getAttentionContext,
  getExecutiveSummaryContext,
  getHealthAreaContext,
} from '@/lib/leadership/card-context';
import {
  ContextSummaryCard,
  HealthAreaDrillCard,
} from '@/components/leadership/DashboardCardDetail';
import {
  FocusAreasPrintTable,
  HealthAreasPrintTable,
  LeadershipAttentionPrintTable,
} from '@/components/leadership/LeadershipPrintTables';

const STATUS_STYLES = {
  green: {
    badge: 'bg-emerald-600 text-white',
    card: 'border-emerald-200 bg-emerald-50/80',
    dot: 'bg-emerald-500',
  },
  yellow: {
    badge: 'bg-amber-500 text-amber-950',
    card: 'border-amber-200 bg-amber-50/80',
    dot: 'bg-amber-400',
  },
  red: {
    badge: 'bg-red-600 text-white',
    card: 'border-red-200 bg-red-50/80',
    dot: 'bg-red-500',
  },
  neutral: {
    badge: 'bg-gray-500 text-white',
    card: 'border-gray-200 bg-gray-50',
    dot: 'bg-gray-400',
  },
} as const;

const PROGRESS_STYLES = {
  progress: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  partial: 'bg-amber-100 text-amber-900 ring-amber-300',
  limited: 'bg-orange-100 text-orange-900 ring-orange-300',
  neutral: 'bg-gray-100 text-gray-700 ring-gray-300',
} as const;

function StatusBadge({ status, large }: { status: string; large?: boolean }) {
  const tone = normalizeStatus(status);
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded font-semibold',
        STATUS_STYLES[tone].badge,
        large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
      )}
    >
      {status.replace(/\*\*/g, '')}
    </span>
  );
}

function ProgressBadge({ value }: { value: string }) {
  const tone = normalizeProgress(value);
  return (
    <span
      className={clsx(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        PROGRESS_STYLES[tone],
      )}
    >
      {value}
    </span>
  );
}

function DashboardTable({
  table,
  compact,
  statusColumn,
  progressColumn,
}: {
  table: ParsedTable;
  compact?: boolean;
  statusColumn?: number;
  progressColumn?: number;
}) {
  if (table.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 print:overflow-visible print:rounded-none print:border-gray-300">
      <table
        className={clsx(
          'brief-pdf-table w-full border-collapse text-left',
          compact ? 'text-xs' : 'text-sm',
          'print:text-[8px] print:leading-tight',
        )}
      >
        <thead>
          <tr className="bg-slate-800 text-white">
            {table.headers.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold print:px-1.5 print:py-1">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-gray-100 even:bg-gray-50/80 print:border-gray-200">
              {row.cells.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 align-top text-gray-800 print:px-1.5 print:py-1">
                  {ci === statusColumn ? <StatusBadge status={cell} /> : null}
                  {ci === progressColumn ? <ProgressBadge value={cell} /> : null}
                  {ci !== statusColumn && ci !== progressColumn ? (
                    <span className="leading-snug">{cell}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthAreaCard({ row }: { row: HealthAreaRow }) {
  const tone = normalizeStatus(row.status);
  const context = getHealthAreaContext(row.area);

  if (context) {
    return (
      <HealthAreaDrillCard
        area={row.area}
        statusBadge={<StatusBadge status={row.status} />}
        signal={row.signal}
        interpretation={row.interpretation}
        context={context}
        cardClassName={STATUS_STYLES[tone].card}
      />
    );
  }

  return (
    <div className={clsx('flex flex-col rounded-lg border p-3 shadow-sm', STATUS_STYLES[tone].card)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight text-gray-900">{row.area}</h4>
        <StatusBadge status={row.status} />
      </div>
      <p className="mb-1 text-xs text-gray-600">{row.signal}</p>
      <p className="text-xs leading-snug text-gray-700">{row.interpretation}</p>
    </div>
  );
}

function HealthSummaryBar({ areas }: { areas: HealthAreaRow[] }) {
  const counts = { green: 0, yellow: 0, red: 0, neutral: 0 };
  for (const a of areas) counts[normalizeStatus(a.status)] += 1;
  const total = areas.length || 1;
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
      {(['green', 'yellow', 'red'] as const).map((tone) => {
        const pct = (counts[tone] / total) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={tone}
            className={STATUS_STYLES[tone].dot}
            style={{ width: `${pct}%` }}
            title={`${counts[tone]} ${tone}`}
          />
        );
      })}
    </div>
  );
}

function PageShell({
  pageNum,
  title,
  subtitle,
  active,
  children,
}: {
  pageNum: number;
  title: string;
  subtitle?: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        'leadership-print-page rounded-xl border border-gray-200 bg-white shadow-sm',
        active ? 'block' : 'hidden',
        'print:block print:rounded-none print:border-0 print:shadow-none',
      )}
      data-page={pageNum}
      aria-label={title}
    >
      <header className="leadership-print-header border-b border-gray-200 bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-4 text-white print:border-gray-300 print:bg-slate-900 print:px-0 print:py-1.5 print:mb-1">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-300 print:text-[8px] print:leading-tight">
          Expand 3 CSE Executive Brief · Page {pageNum} of 3
        </p>
        <h2 className="mt-1 text-xl font-semibold print:mt-0.5 print:text-sm">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-300 print:mt-0.5 print:text-[9px]">{subtitle}</p>
        )}
      </header>
      <div className="leadership-print-body space-y-5 p-5 print:space-y-2 print:p-0 print:pt-1.5">
        {children}
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  status,
  small,
}: {
  label: string;
  value: string;
  status?: string;
  small?: boolean;
}) {
  const tone = status ? normalizeStatus(status) : 'neutral';
  return (
    <div
      className={clsx(
        'rounded-lg border p-3 ring-1 ring-inset',
        'print:rounded print:p-1.5',
        status ? STATUS_STYLES[tone].card : 'border-gray-200 bg-white ring-gray-100',
      )}
    >
      <p className="text-xs font-medium text-gray-500 print:text-[7px]">{label}</p>
      {status ? (
        <div className="mt-2">
          <StatusBadge status={status} large />
        </div>
      ) : (
        <p className={clsx('mt-1 font-semibold text-gray-900', small ? 'text-sm' : 'text-lg', 'print:mt-0.5 print:text-[9px]')}>
          {value}
        </p>
      )}
      {status && small && (
        <p className="mt-2 text-xs text-gray-600 print:mt-0.5 print:text-[7px] print:leading-tight">{value}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="leadership-print-section print:mb-2">
      <h3 className="mb-2 border-b border-gray-100 pb-1 text-sm font-semibold text-gray-900 print:mb-0.5 print:pb-0.5 print:text-[8pt]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Page1Dashboard({ data, active }: { data: LeadershipReportData; active: boolean }) {
  const { strategicPosture: sp, healthAreas, executiveSummary, leadershipAttention, meta } =
    data;
  const headlineMetrics = data.evidenceSummary.rows.slice(0, 4);

  return (
    <PageShell
      pageNum={1}
      title="Portfolio Health"
      subtitle={meta.reportingPeriod ? `Reporting period: ${meta.reportingPeriod}` : undefined}
      active={active}
    >
      {headlineMetrics.length > 0 && (
        <div className="brief-screen-only grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          {headlineMetrics.map((row) => (
            <div
              key={row.cells[0]}
              className="rounded-lg border border-slate-200 bg-slate-900 px-3 py-3 text-white print:rounded print:px-2 print:py-1.5"
            >
              <p className="text-xs font-medium text-slate-300 print:text-[7px] print:leading-tight">
                {row.cells[0]}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums print:mt-0.5 print:text-[10px]">
                {row.cells[1]}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="leadership-kpi-row grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-1">
        <KpiTile label="Overall status" value={sp.overallStatus ?? '—'} status={sp.overallStatus} />
        <KpiTile label="Confidence" value={sp.confidence ?? '—'} />
        <KpiTile label="Strategic posture" value={sp.strategicPosture ?? '—'} small />
        <KpiTile label="Primary attention" value={sp.primaryAttention ?? '—'} small />
      </div>

      {healthAreas.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2 print:mb-1">
            <h3 className="text-sm font-semibold text-gray-900 print:text-[9px]">
              Portfolio health signals
            </h3>
            <span className="text-xs text-gray-500 print:hidden">{healthAreas.length} areas tracked</span>
          </div>
          <div className="brief-screen-only print:hidden">
            <HealthSummaryBar areas={healthAreas} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {healthAreas.map((row) => (
                <HealthAreaCard key={row.area} row={row} />
              ))}
            </div>
          </div>
          <div className="hidden brief-export-only print:block">
            <HealthAreasPrintTable areas={healthAreas} />
          </div>
        </div>
      )}

      {executiveSummary.length > 0 && (
        <div className="brief-screen-only print:hidden">
          <h3 className="mb-2 text-sm font-semibold text-gray-900 print:mb-1 print:text-[9px]">
            Executive summary
          </h3>
          <div className="brief-screen-only grid gap-2 md:grid-cols-2 print:hidden">
            {executiveSummary.map((b) => {
              const ctx = getExecutiveSummaryContext(b.label);
              return (
                <div
                  key={b.label}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 print:break-inside-avoid"
                >
                  <ContextSummaryCard
                    title={b.label}
                    body={b.body}
                    overview={ctx?.overview}
                    titleClassName="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {leadershipAttention.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 print:mb-1 print:text-[9px]">
            Leadership attention needed
          </h3>
          <div className="brief-screen-only space-y-2 print:hidden">
            {leadershipAttention.map((row) => {
              const ctx = getAttentionContext(row.item);
              return (
              <div
                key={row.item}
                className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 md:grid-cols-[1fr_2fr_auto] print:break-inside-avoid"
              >
                <div>
                  <ContextSummaryCard
                    title={row.item}
                    body={row.why}
                    overview={ctx?.overview}
                    titleClassName="font-semibold text-gray-900"
                    className="text-xs text-gray-600"
                  />
                </div>
                <p className="text-sm text-gray-800">
                  <span className="font-medium text-amber-900">Ask: </span>
                  {row.ask}
                </p>
                <div className="text-xs text-gray-600 md:text-right">
                  <p>
                    <span className="font-medium">Owner:</span> {row.owner}
                  </p>
                  <p>
                    <span className="font-medium">By:</span> {row.neededBy}
                  </p>
                </div>
              </div>
            );
            })}
          </div>
          <div className="hidden brief-export-only print:block">
            <LeadershipAttentionPrintTable rows={leadershipAttention} />
          </div>
        </div>
      )}

      {sp.staffAssessment && (
        <div className="leadership-staff-read rounded-lg border border-slate-200 bg-slate-50 p-4 print:rounded print:border-0 print:bg-transparent print:p-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 print:text-[8px]">
            CSE leadership read
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-800 print:mt-1 print:text-[8px] print:leading-snug">
            {sp.staffAssessment}
          </p>
        </div>
      )}
    </PageShell>
  );
}

function Page2Details({ data, active }: { data: LeadershipReportData; active: boolean }) {
  return (
    <PageShell pageNum={2} title="Portfolio Drill-In" active={active}>
      {data.strategicAlignment.rows.length > 0 && (
        <Section title="Strategic alignment to CSE goals">
          <DashboardTable table={data.strategicAlignment} progressColumn={1} compact />
        </Section>
      )}
      {data.outcomesDelivered.rows.length > 0 && (
        <Section title="Outcomes delivered this week">
          <div className="brief-screen-only grid gap-2 print:hidden">
            {data.outcomesDelivered.rows.map((row, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <p className="font-semibold text-gray-900">{row.cells[0]}</p>
                <dl className="mt-2 grid gap-1 text-xs text-gray-700 sm:grid-cols-2">
                  {data.outcomesDelivered.headers.slice(1).map((h, hi) => (
                    <div key={h}>
                      <dt className="font-medium text-gray-500">{h}</dt>
                      <dd>{row.cells[hi + 1]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden brief-export-only print:block">
            <DashboardTable table={data.outcomesDelivered} compact />
          </div>
        </Section>
      )}
      {data.workInProgress.rows.length > 0 && (
        <Section title="Key work in progress">
          <DashboardTable table={data.workInProgress} compact />
        </Section>
      )}
      {data.engineeringHealth.rows.length > 0 && (
        <Section title="Portfolio data confidence">
          <div className="leadership-confidence-grid grid gap-2 sm:grid-cols-2 print:grid-cols-3 print:gap-1">
            {data.engineeringHealth.rows.map((row, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-lg border border-gray-200 px-3 py-2 print:rounded print:px-1.5 print:py-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-900 print:text-[8px]">{row.cells[0]}</p>
                  <p className="mt-0.5 text-xs text-gray-600 print:mt-0 print:text-[7px] print:leading-tight">
                    {row.cells[1]}
                  </p>
                </div>
                {normalizeStatus(row.cells[1] ?? '') !== 'neutral' && (
                  <span className="print:hidden">
                    <StatusBadge status={row.cells[1] ?? ''} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.evidenceSummary.rows.length > 0 && (
        <Section title="Evidence summary">
          <div className="leadership-evidence-grid grid gap-2 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-1">
            {data.evidenceSummary.rows.map((row, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 print:rounded print:px-1.5 print:py-1"
              >
                <p className="text-xs font-medium text-gray-500 print:text-[7px]">{row.cells[0]}</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 print:mt-0 print:text-[8px]">
                  {row.cells[1]}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageShell>
  );
}

function Page3Recommendations({
  data,
  active,
  footnote,
}: {
  data: LeadershipReportData;
  active: boolean;
  footnote?: string;
}) {
  const { aiAdoption } = data;
  return (
    <PageShell pageNum={3} title="Next Week Focus" active={active}>
      {data.focusAreas.rows.length > 0 && (
        <Section title="Recommended focus areas">
          <div className="brief-screen-only space-y-3 print:hidden">
            {data.focusAreas.rows.map((row, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{row.cells[0]}</p>
                  <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    {data.focusAreas.headers.slice(1).map((h, hi) => (
                      <div key={h}>
                        <dt className="font-medium text-gray-500">{h}</dt>
                        <dd className="text-gray-800">{row.cells[hi + 1]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden brief-export-only print:block">
            <FocusAreasPrintTable data={data} />
          </div>
        </Section>
      )}
      {data.staffRecommendations.rows.length > 0 && (
        <Section title="CSE management recommendations">
          <DashboardTable table={data.staffRecommendations} compact />
        </Section>
      )}
      {data.risks.rows.length > 0 && (
        <Section title="Risks to watch">
          <DashboardTable table={data.risks} compact />
        </Section>
      )}
      {(aiAdoption.useCase || aiAdoption.why) && (
        <Section title="AI adoption opportunity">
          <div className="rounded-lg border-2 border-violet-200 bg-violet-50/50 p-4 print:rounded print:border print:p-2">
            {aiAdoption.useCase && (
              <p className="text-sm font-semibold text-violet-950 print:text-[8px] print:leading-snug">
                {aiAdoption.useCase}
              </p>
            )}
            {aiAdoption.why && (
              <p className="mt-2 text-sm text-gray-800 print:mt-1 print:text-[8px] print:leading-snug">
                {aiAdoption.why}
              </p>
            )}
            {aiAdoption.pilot && (
              <p className="mt-2 text-xs text-gray-700 print:mt-1 print:text-[7px] print:leading-snug">
                <span className="font-semibold">Pilot: </span>
                {aiAdoption.pilot}
              </p>
            )}
            {aiAdoption.successSignal && (
              <p className="mt-2 text-xs text-gray-700 print:mt-1 print:text-[7px] print:leading-snug">
                <span className="font-semibold">Success signal: </span>
                {aiAdoption.successSignal}
              </p>
            )}
          </div>
        </Section>
      )}
      {data.closingAssessment.length > 0 && (
        <Section title="Closing leadership assessment">
          <ul className="space-y-2 print:space-y-1">
            {data.closingAssessment.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm print:rounded print:px-2 print:py-1 print:text-[8px] print:leading-snug"
              >
                <span className="font-bold text-slate-500">{i + 1}.</span>
                <span className="text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {footnote && (
        <p className="hidden brief-export-only text-center text-[7px] leading-snug text-gray-500 print:mt-1 print:block">
          {footnote}
        </p>
      )}
    </PageShell>
  );
}

export function LeadershipDashboard({
  markdown,
  slug,
}: {
  markdown: string;
  slug: string;
}) {
  const data = useMemo(
    () => toExecDashboardData(parseLeadershipReport(markdown)),
    [markdown],
  );
  const isWeekly = slug.startsWith('weekly-report-') && data.pages.length >= 3;
  const [activePage, setActivePage] = useState(1);

  if (!isWeekly) {
    return (
      <article className="rounded-lg border border-gray-200 bg-white p-4">
        <MarkdownDocument markdown={markdown} />
      </article>
    );
  }

  return (
    <div
      className="leadership-dashboard space-y-4"
      data-export-filename={`${slug}.pdf`}
    >
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Expand 3 · Renewal, Churn & Upsell
            </p>
            <h2 className="text-lg font-semibold text-gray-900">
              {data.meta.title.replace(/^Expand 3 CSE Executive Brief$/, 'CSE Executive Brief')}
            </h2>
            {data.meta.reportingPeriod && (
              <p className="text-sm text-gray-600">{data.meta.reportingPeriod}</p>
            )}
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Report pages">
            {data.pages.map((p) => (
              <button
                key={p.num}
                type="button"
                onClick={() => setActivePage(p.num)}
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  activePage === p.num
                    ? 'bg-slate-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                )}
              >
                {p.num}. {p.title.split(' ').slice(0, 3).join(' ')}
              </button>
            ))}
          </nav>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Weekly portfolio brief for CSE leadership — renewal risk, save motions, and customer
          engagement. Download PDF exports all three landscape pages.
        </p>
      </div>

      <div className="leadership-brief-pages">
        <Page1Dashboard data={data} active={activePage === 1} />
        <Page2Details data={data} active={activePage === 2} />
        <Page3Recommendations data={data} active={activePage === 3} footnote={data.footnote} />
      </div>
    </div>
  );
}

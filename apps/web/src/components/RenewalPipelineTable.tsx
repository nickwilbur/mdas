'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OverallAssessmentCell } from '@/components/OverallAssessmentCell';
import { EngagementDaysCell } from '@/components/EngagementDaysCell';
import { MetricHint } from '@/components/MetricHint';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import { useLocalStorage } from '@/components/useLocalStorage';
import { RENEWAL_METRIC_HINTS } from '@/lib/renewal-metric-tooltips';
import {
  DEFAULT_PIPELINE_COLUMN_ORDER,
  DEFAULT_PIPELINE_COLUMN_WIDTHS,
  normalizePipelineColumnLayout,
  PIPELINE_COLUMN_MIN_WIDTH,
  PIPELINE_COLUMNS_STORAGE_KEY,
  pipelineColumnLayoutSerializer,
  type PipelineColumnId,
  type PipelineColumnLayout,
} from '@/lib/renewal-pipeline-columns';
import type { RenewalOppRow, RenewalOutcome } from '@mdas/renewal-metrics';
import { isOpenRenewalOppRow, prospectivePipelineStatus } from '@mdas/renewal-metrics';
import { fmtUSD } from '@/components/ui';

export type PipelineSortField =
  | 'account'
  | 'opportunity'
  | 'cse'
  | 'renewalDate'
  | 'stage'
  | 'atr'
  | 'renewed'
  | 'downsell'
  | 'overallAssessment'
  | 'slackUpdate'
  | 'customerEngagement';

const COLUMN_SORT: Partial<Record<PipelineColumnId, PipelineSortField>> = {
  account: 'account',
  opportunity: 'opportunity',
  cse: 'cse',
  closeDate: 'renewalDate',
  stage: 'stage',
  atr: 'atr',
  forecast: 'renewed',
  downsell: 'downsell',
  overallAssessment: 'overallAssessment',
  slackUpdate: 'slackUpdate',
  customerEngagement: 'customerEngagement',
};

const COLUMN_LABELS: Record<PipelineColumnId, string> = {
  account: 'Account',
  opportunity: 'Opportunity',
  cse: 'CSE',
  closeDate: 'Close date',
  stage: 'Stage',
  status: 'Status',
  atr: 'ATR',
  forecast: 'Forecast',
  downsell: 'Downsell',
  nextStep: 'Next step',
  overallAssessment: 'Overall Assessment',
  slackUpdate: 'Slack',
  customerEngagement: 'Engagement',
};

const COLUMN_HINTS: Partial<Record<PipelineColumnId, string>> = {
  status:
    'Open = renewal not yet closed. Pushed = past close date, still open. Forecast downsell shows when ML is below ATR.',
  overallAssessment: RENEWAL_METRIC_HINTS.overallAssessment,
  slackUpdate: RENEWAL_METRIC_HINTS.daysSinceSlackUpdate,
  customerEngagement: RENEWAL_METRIC_HINTS.daysSinceCustomerEngagement,
};

const RIGHT_ALIGN: Set<PipelineColumnId> = new Set([
  'atr',
  'forecast',
  'downsell',
  'slackUpdate',
  'customerEngagement',
]);

const CENTER_ALIGN: Set<PipelineColumnId> = new Set(['overallAssessment']);

const OUTCOME_LABELS: Record<RenewalOutcome, string> = {
  flat: 'Renewed flat',
  downsell: 'Downsell',
  full_churn: 'Full churn',
  expanded: 'Expanded',
  pending: 'Open',
  pushed: 'Pushed',
};

function HeaderLabel({ columnId }: { columnId: PipelineColumnId }) {
  const hint = COLUMN_HINTS[columnId];
  return (
    <span className="inline-flex items-center gap-0.5">
      {COLUMN_LABELS[columnId]}
      {hint ? <MetricHint text={hint} placement="bottom" /> : null}
    </span>
  );
}

export interface RenewalPipelineTableProps {
  rows: RenewalOppRow[];
  sortField: PipelineSortField;
  sortDirection: SortDirection;
  onSort: (field: PipelineSortField) => void;
  cseOptions: { value: string; label: string }[];
  cseFilter: Set<string>;
  onCseFilterChange: (selected: Set<string>) => void;
  overallAssessmentOptions: { value: string; label: string }[];
  overallAssessmentFilter: Set<string>;
  onOverallAssessmentFilterChange: (selected: Set<string>) => void;
}

export function RenewalPipelineTable({
  rows,
  sortField,
  sortDirection,
  onSort,
  cseOptions,
  cseFilter,
  onCseFilterChange,
  overallAssessmentOptions,
  overallAssessmentFilter,
  onOverallAssessmentFilterChange,
}: RenewalPipelineTableProps): JSX.Element {
  const [layout, setLayout] = useLocalStorage<PipelineColumnLayout>(
    PIPELINE_COLUMNS_STORAGE_KEY,
    normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: DEFAULT_PIPELINE_COLUMN_WIDTHS,
    }),
    pipelineColumnLayoutSerializer,
  );

  const normalized = normalizePipelineColumnLayout(layout);
  const [dragColumn, setDragColumn] = useState<PipelineColumnId | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineColumnId | null>(null);
  const resizeRef = useRef<{
    columnId: PipelineColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  const reorderColumn = useCallback(
    (from: PipelineColumnId, to: PipelineColumnId) => {
      if (from === to) return;
      setLayout((prev) => {
        const base = normalizePipelineColumnLayout(prev);
        const order = [...base.order];
        const fromIdx = order.indexOf(from);
        const toIdx = order.indexOf(to);
        if (fromIdx < 0 || toIdx < 0) return base;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, from);
        return { ...base, order };
      });
    },
    [setLayout],
  );

  const startResize = useCallback(
    (columnId: PipelineColumnId, clientX: number) => {
      const width = normalized.widths[columnId] ?? DEFAULT_PIPELINE_COLUMN_WIDTHS[columnId];
      resizeRef.current = { columnId, startX: clientX, startWidth: width };
    },
    [normalized.widths],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      const delta = e.clientX - active.startX;
      const nextWidth = Math.max(PIPELINE_COLUMN_MIN_WIDTH, active.startWidth + delta);
      setLayout((prev) => {
        const base = normalizePipelineColumnLayout(prev);
        return {
          ...base,
          widths: { ...base.widths, [active.columnId]: nextWidth },
        };
      });
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [setLayout]);

  const renderCell = (columnId: PipelineColumnId, row: RenewalOppRow) => {
    switch (columnId) {
      case 'account':
        return (
          <Link href={`/accounts/${row.accountId}`} className="font-medium hover:underline">
            {row.accountName}
          </Link>
        );
      case 'opportunity':
        return (
          <Link
            href={`/opportunities?focus=${row.opportunityId}`}
            className="block truncate hover:underline"
            title={row.opportunityName}
          >
            {row.opportunityName}
          </Link>
        );
      case 'cse':
        return <span className="text-gray-700">{row.cseName ?? '—'}</span>;
      case 'closeDate':
        return <span className="tabular-nums">{row.closeDate ?? '—'}</span>;
      case 'stage':
        return (
          <span className="block truncate text-gray-600" title={row.stageName}>
            {row.stageName}
          </span>
        );
      case 'status':
        return isOpenRenewalOppRow(row) ? (
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs ${
              row.outcome === 'pushed'
                ? 'bg-orange-100 text-orange-800'
                : 'bg-blue-50 text-blue-800'
            }`}
          >
            {prospectivePipelineStatus(row.outcome, {
              atrUSD: row.atrUSD,
              renewedRevenueUSD: row.renewedRevenueUSD,
            })}
          </span>
        ) : (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {OUTCOME_LABELS[row.outcome]}
          </span>
        );
      case 'atr':
        return <span className="tabular-nums">{fmtUSD(row.atrUSD)}</span>;
      case 'forecast':
        return <span className="tabular-nums">{fmtUSD(row.renewedRevenueUSD)}</span>;
      case 'downsell':
        return (
          <span className="tabular-nums text-amber-700">
            {row.downsellAmountUSD > 0 ? fmtUSD(row.downsellAmountUSD) : '—'}
          </span>
        );
      case 'nextStep':
        return (
          <span className="block truncate text-gray-600" title={row.nextStep ?? undefined}>
            {row.nextStep ?? '—'}
          </span>
        );
      case 'overallAssessment':
        return (
          <OverallAssessmentCell
            category={row.overallAssessment}
            detail={row.overallAssessmentDetail}
            riskScore={row.healthScore}
            riskBand={row.healthBand}
            riskConfidence={row.riskScoreConfidence}
            signals={row.riskSignals}
          />
        );
      case 'slackUpdate':
        return (
          <EngagementDaysCell
            days={row.daysSinceSlackUpdate}
            lastTouch={row.slackLastTouch}
            label="Last Slack post"
          />
        );
      case 'customerEngagement':
        return (
          <EngagementDaysCell
            days={row.daysSinceCustomerEngagement}
            lastTouch={row.customerEngagementLastTouch}
            label="Last customer engagement"
          />
        );
      default:
        return null;
    }
  };

  const renderHeaderContent = (columnId: PipelineColumnId) => {
    const sortKey = COLUMN_SORT[columnId];
    const align = RIGHT_ALIGN.has(columnId)
      ? 'right'
      : CENTER_ALIGN.has(columnId)
        ? 'center'
        : 'left';

    const headerClass =
      'px-2 py-2 text-xs font-medium uppercase text-gray-500';

    if (columnId === 'cse') {
      return (
        <TableHeader
          bare
          label={<HeaderLabel columnId={columnId} />}
          field={sortKey}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          filterOptions={cseOptions}
          selectedFilters={cseFilter}
          onFilterChange={onCseFilterChange}
          align={align}
          className={headerClass}
        />
      );
    }

    if (columnId === 'overallAssessment') {
      return (
        <TableHeader
          bare
          label={<HeaderLabel columnId={columnId} />}
          field={sortKey}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          filterOptions={overallAssessmentOptions}
          selectedFilters={overallAssessmentFilter}
          onFilterChange={onOverallAssessmentFilterChange}
          align={align}
          className={headerClass}
        />
      );
    }

    if (sortKey) {
      return (
        <TableHeader
          bare
          label={<HeaderLabel columnId={columnId} />}
          field={sortKey}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          align={align}
          className={headerClass}
        />
      );
    }

    return (
      <div
        className={`${headerClass} ${
          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
        }`}
      >
        <HeaderLabel columnId={columnId} />
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm" style={{ minWidth: '100%' }}>
        <colgroup>
          {normalized.order.map((columnId) => (
            <col
              key={columnId}
              style={{
                width: normalized.widths[columnId] ?? DEFAULT_PIPELINE_COLUMN_WIDTHS[columnId],
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b bg-gray-50/80">
            {normalized.order.map((columnId) => {
              const isDrop = dropTarget === columnId && dragColumn !== columnId;
              return (
                <th
                  key={columnId}
                  draggable
                  onDragStart={(e) => {
                    setDragColumn(columnId);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', columnId);
                  }}
                  onDragEnd={() => {
                    setDragColumn(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragColumn && dragColumn !== columnId) setDropTarget(columnId);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === columnId) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragColumn ??
                      (e.dataTransfer.getData('text/plain') as PipelineColumnId);
                    if (from) reorderColumn(from, columnId);
                    setDragColumn(null);
                    setDropTarget(null);
                  }}
                  className={`relative ${isDrop ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''} ${
                    dragColumn === columnId ? 'opacity-50' : ''
                  }`}
                  style={{ cursor: dragColumn ? 'grabbing' : 'grab' }}
                  title="Drag to reorder · drag right edge to resize"
                >
                  {renderHeaderContent(columnId)}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${COLUMN_LABELS[columnId]} column`}
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none hover:bg-blue-300/60"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startResize(columnId, e.clientX);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventPropagation()}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.opportunityId} className="border-b border-gray-100 hover:bg-gray-50">
              {normalized.order.map((columnId) => {
                const align = RIGHT_ALIGN.has(columnId)
                  ? 'text-right'
                  : CENTER_ALIGN.has(columnId)
                    ? 'text-center'
                    : 'text-left';
                return (
                  <td key={columnId} className={`overflow-hidden px-2 py-2 ${align}`}>
                    {renderCell(columnId, row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import React from 'react';
import {
  BucketBadge,
  RelativeTime,
  RiskBadge,
  SentimentBadge,
  SourceDots,
  fmtUSD,
} from '@/components/ui';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import type { AccountView, AdapterSource } from '@mdas/canonical';

// Order matters — this is the left-to-right dot order in every row,
// matching the four real adapters wired in PR-3..PR-7. Keep in sync
// with EXPECTED_SOURCES on the Drill-In page so a reader who learns
// "3rd dot is gainsight" on the table sees the same on the detail.
const EXPECTED_SOURCES: AdapterSource[] = [
  'salesforce',
  'cerebro',
  'gainsight',
  'glean-mcp',
];

type SortField =
  | 'cse'
  | 'account'
  | 'bucket'
  | 'risk'
  | 'sentiment'
  | 'atr'
  | 'acvDelta'
  | 'renewal'
  | 'hygiene'
  | 'lastSentimentUpdate'
  | 'data'
  | 'salesforce';

interface AccountsTableProps {
  views: AccountView[];
}

export function AccountsTable({ views }: AccountsTableProps) {
  const [sortField, setSortField] = useState<SortField>('account');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [cseFilter, setCseFilter] = useState<Set<string>>(new Set());

  // Distinct CSE names for filter
  const filterOptions = useMemo(() => {
    const cses = new Set<string>();
    views.forEach((v) => {
      cses.add(v.account.assignedCSE?.name ?? 'Unassigned');
    });
    return {
      cses: Array.from(cses).sort().map((v) => ({ value: v, label: v })),
    };
  }, [views]);

  // Apply filters
  const filteredViews = useMemo(() => {
    return views.filter((v) => {
      const cseName = v.account.assignedCSE?.name ?? 'Unassigned';
      if (cseFilter.size > 0 && !cseFilter.has(cseName)) return false;
      return true;
    });
  }, [views, cseFilter]);

  // Sort
  const sortedViews = useMemo(() => {
    const result = [...filteredViews];
    result.sort((a, b) => {
      let aVal: string | number = 0;
      let bVal: string | number = 0;
      switch (sortField) {
        case 'cse':
          aVal = a.account.assignedCSE?.name ?? 'Unassigned';
          bVal = b.account.assignedCSE?.name ?? 'Unassigned';
          break;
        case 'account':
          aVal = a.account.accountName;
          bVal = b.account.accountName;
          break;
        case 'bucket':
          aVal = a.bucket;
          bVal = b.bucket;
          break;
        case 'risk':
          aVal = a.risk.level ?? '';
          bVal = b.risk.level ?? '';
          break;
        case 'sentiment':
          aVal = a.account.cseSentiment ?? '';
          bVal = b.account.cseSentiment ?? '';
          break;
        case 'atr':
          aVal = a.atrUSD;
          bVal = b.atrUSD;
          break;
        case 'acvDelta':
          aVal = a.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
          bVal = b.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
          break;
        case 'renewal':
          aVal = a.daysToRenewal ?? 99999;
          bVal = b.daysToRenewal ?? 99999;
          break;
        case 'hygiene':
          aVal = a.hygiene.score;
          bVal = b.hygiene.score;
          break;
        case 'lastSentimentUpdate':
          aVal = a.account.cseSentimentCommentaryLastUpdated ?? '';
          bVal = b.account.cseSentimentCommentaryLastUpdated ?? '';
          break;
        case 'data':
          aVal = '';
          bVal = '';
          break;
        case 'salesforce':
          aVal = '';
          bVal = '';
          break;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [filteredViews, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const AccountRow = ({ v }: { v: AccountView }) => {
    const acvDelta = v.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
    const sfLink = v.account.sourceLinks?.find((l) => l.source === 'salesforce');
    const url =
      sfLink?.url ?? `https://zuora.lightning.force.com/lightning/r/Account/${v.account.salesforceAccountId}/view`;

    return (
      <tr key={v.account.accountId} className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2 font-medium text-gray-700">{v.account.assignedCSE?.name ?? '—'}</td>
        <td className="px-3 py-2 font-medium">
          <Link href={`/accounts/${v.account.accountId}`} className="hover:underline">
            {v.account.accountName}
          </Link>
        </td>
        <td className="px-3 py-2"><BucketBadge bucket={v.bucket} /></td>
        <td className="px-3 py-2"><RiskBadge level={v.risk.level} source={v.risk.source} /></td>
        <td className="px-3 py-2"><SentimentBadge value={v.account.cseSentiment} /></td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(v.atrUSD)}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${acvDelta < 0 ? 'text-red-700' : acvDelta > 0 ? 'text-green-700' : 'text-gray-600'}`}>
          {fmtUSD(acvDelta)}
        </td>
        <td className="px-3 py-2 text-gray-700">
          {v.daysToRenewal == null ? '—' : `${v.daysToRenewal}d`}
        </td>
        <td className="px-3 py-2 text-center">
          {v.hygiene.score === 0 ? (
            <span className="text-gray-400">0</span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {v.hygiene.score}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">
          <RelativeTime iso={v.account.cseSentimentCommentaryLastUpdated} />
        </td>
        <td className="px-3 py-2">
          <SourceDots
            freshness={v.account.lastFetchedFromSource}
            errors={v.account.sourceErrors}
            expectedSources={EXPECTED_SOURCES}
          />
        </td>
        <td className="px-3 py-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            View
          </a>
        </td>
      </tr>
    );
  };

  const commonHeader = {
    sortField,
    sortDirection,
    onSort: handleSort,
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <TableHeader<SortField>
                {...commonHeader}
                label="CSE"
                field="cse"
                filterOptions={filterOptions.cses}
                selectedFilters={cseFilter}
                onFilterChange={setCseFilter}
              />
              <TableHeader<SortField> {...commonHeader} label="Account" field="account" />
              <TableHeader<SortField> {...commonHeader} label="Bucket" field="bucket" />
              <TableHeader<SortField> {...commonHeader} label="Risk" field="risk" />
              <TableHeader<SortField> {...commonHeader} label="Sentiment" field="sentiment" />
              <TableHeader<SortField> {...commonHeader} label="ATR" field="atr" align="right" />
              <TableHeader<SortField> {...commonHeader} label="ACV Δ" field="acvDelta" align="right" />
              <TableHeader<SortField> {...commonHeader} label="Renewal" field="renewal" />
              <TableHeader<SortField> {...commonHeader} label="Hygiene" field="hygiene" align="center" />
              <TableHeader<SortField> {...commonHeader} label="Last Sentiment Update" field="lastSentimentUpdate" />
              <TableHeader<SortField>
                {...commonHeader}
                label="Data"
                field="data"
              />
              <TableHeader<SortField> {...commonHeader} label="Salesforce" />
            </tr>
          </thead>
          <tbody>
            {sortedViews.map(v => <AccountRow key={v.account.accountId} v={v} />)}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Showing {sortedViews.length} of {views.length} accounts. Click headers to sort, use the funnel icon to filter by CSE.
      </p>
    </>
  );
}

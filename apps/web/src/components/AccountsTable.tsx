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
  | 'salesforce'
  | 'closeDate'
  | 'churnDate';

interface AccountsTableProps {
  views: AccountView[];
}

export function AccountsTable({ views }: AccountsTableProps) {
  const [sortField, setSortField] = useState<SortField>('account');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [cseFilter, setCseFilter] = useState<Set<string>>(new Set());
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

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

  // Group by bucket
  const groupedViews = useMemo(() => {
    const groups = {
      'Confirmed Churn': [] as AccountView[],
      'Saveable Risk': [] as AccountView[],
      'Healthy': [] as AccountView[],
    };
    
    filteredViews.forEach(v => {
      if (groups[v.bucket] !== undefined) {
        groups[v.bucket].push(v);
      }
    });
    
    return groups;
  }, [filteredViews]);

  // Sort
  const sortViews = (viewsToSort: AccountView[]) => {
    const result = [...viewsToSort];
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
        case 'closeDate':
          aVal = a.opportunities[0]?.closeDate ?? '';
          bVal = b.opportunities[0]?.closeDate ?? '';
          break;
        case 'churnDate':
          aVal = a.account.churnDate ?? '';
          bVal = b.account.churnDate ?? '';
          break;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const handleSelectSection = (sectionViews: AccountView[]) => {
    const sectionIds = new Set(sectionViews.map(v => v.account.accountId));
    const allSelected = sectionIds.size > 0 && [...sectionIds].every(id => selectedAccounts.has(id));
    
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      if (allSelected) {
        sectionIds.forEach(id => next.delete(id));
      } else {
        sectionIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const AccountRow = ({ v, bucket }: { v: AccountView; bucket: string }) => {
    const acvDelta = v.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
    const sfLink = v.account.sourceLinks?.find((l) => l.source === 'salesforce');
    const url =
      sfLink?.url ?? `https://zuora.lightning.force.com/lightning/r/Account/${v.account.salesforceAccountId}/view`;
    const isSelected = selectedAccounts.has(v.account.accountId);

    // Get close date for Saveable Risk
    const closeDate = bucket === 'Saveable Risk' 
      ? v.opportunities[0]?.closeDate 
      : null;
    
    // Get churn date for Confirmed Churn
    const churnDate = bucket === 'Confirmed Churn'
      ? v.account.churnDate
      : null;

    return (
      <tr key={v.account.accountId} className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => handleSelectAccount(v.account.accountId)}
            className="rounded border-gray-300"
          />
        </td>
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
        {bucket === 'Saveable Risk' && (
          <td className="px-3 py-2 text-gray-700">
            {closeDate ? new Date(closeDate).toLocaleDateString() : '—'}
          </td>
        )}
        {bucket === 'Confirmed Churn' && (
          <td className="px-3 py-2 text-gray-700">
            {churnDate ? new Date(churnDate).toLocaleDateString() : '—'}
          </td>
        )}
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

  const SectionTable = ({ bucket, views: sectionViews }: { bucket: string; views: AccountView[] }) => {
    const sortedSectionViews = sortViews(sectionViews);
    const sectionIds = new Set(sectionViews.map(v => v.account.accountId));
    const allSelected = sectionIds.size > 0 && [...sectionIds].every(id => selectedAccounts.has(id));

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{bucket}</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{sectionViews.length} accounts</span>
            <button
              onClick={() => handleSelectSection(sectionViews)}
              className="px-2 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => handleSelectSection(sectionViews)}
                    className="rounded border-gray-300"
                  />
                </th>
                <TableHeader<SortField> {...commonHeader} label="CSE" field="cse" />
                <TableHeader<SortField> {...commonHeader} label="Account" field="account" />
                <TableHeader<SortField> {...commonHeader} label="Bucket" field="bucket" />
                <TableHeader<SortField> {...commonHeader} label="Risk" field="risk" />
                <TableHeader<SortField> {...commonHeader} label="Sentiment" field="sentiment" />
                <TableHeader<SortField> {...commonHeader} label="ATR" field="atr" align="right" />
                <TableHeader<SortField> {...commonHeader} label="ACV Δ" field="acvDelta" align="right" />
                <TableHeader<SortField> {...commonHeader} label="Renewal" field="renewal" />
                {bucket === 'Saveable Risk' && (
                  <TableHeader<SortField> {...commonHeader} label="Close Date" field="closeDate" />
                )}
                {bucket === 'Confirmed Churn' && (
                  <TableHeader<SortField> {...commonHeader} label="Churn Date" field="churnDate" />
                )}
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
              {sortedSectionViews.map(v => <AccountRow key={v.account.accountId} v={v} bucket={bucket} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-6">
        {groupedViews['Confirmed Churn'].length > 0 && (
          <SectionTable bucket="Confirmed Churn" views={groupedViews['Confirmed Churn']} />
        )}
        {groupedViews['Saveable Risk'].length > 0 && (
          <SectionTable bucket="Saveable Risk" views={groupedViews['Saveable Risk']} />
        )}
        {groupedViews['Healthy'].length > 0 && (
          <SectionTable bucket="Healthy" views={groupedViews['Healthy']} />
        )}
      </div>
      <p className="text-xs text-gray-500">
        Showing {filteredViews.length} of {views.length} accounts. Click headers to sort, use the funnel icon to filter by CSE, select quarters to filter by fiscal quarter.
      </p>
    </>
  );
}

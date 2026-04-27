'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import React from 'react';
import { BucketBadge, RiskBadge, SentimentBadge, fmtUSD } from '@/components/ui';
import type { AccountView } from '@mdas/canonical';

interface AccountsTableProps {
  views: AccountView[];
}

export function AccountsTable({ views }: AccountsTableProps) {
  const [groupBy, setGroupBy] = useState<'none' | 'cse'>('cse');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (cseName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(cseName)) {
        next.delete(cseName);
      } else {
        next.add(cseName);
      }
      return next;
    });
  };

  const { groupedData, cseNames } = useMemo(() => {
    if (groupBy === 'none') {
      return { groupedData: null, cseNames: [] };
    }

    // Group by CSE
    const groups = new Map<string, AccountView[]>();
    const names = new Set<string>();

    views.forEach(v => {
      const cseName = v.account.assignedCSE?.name ?? 'Unassigned';
      names.add(cseName);
      if (!groups.has(cseName)) {
        groups.set(cseName, []);
      }
      groups.get(cseName)!.push(v);
    });

    return {
      groupedData: groups,
      cseNames: Array.from(names).sort()
    };
  }, [views, groupBy]);

  const AccountRow = ({ v, showCSE }: { v: AccountView; showCSE: boolean }) => {
    const acvDelta = v.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);

    return (
      <tr key={v.account.accountId} className="border-t border-gray-100 hover:bg-gray-50">
        {showCSE && (
          <td className="px-3 py-2 text-gray-700 font-medium">{v.account.assignedCSE?.name ?? '—'}</td>
        )}
        <td className="px-3 py-2 text-gray-500">{v.priorityRank}</td>
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
          {v.account.cseSentimentCommentaryLastUpdated
            ? new Date(v.account.cseSentimentCommentaryLastUpdated).toLocaleDateString()
            : '—'}
        </td>
      </tr>
    );
  };

  const CSEColumn = () => <th className="px-3 py-2">CSE</th>;

  return (
    <>
      {/* Group by selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Group by:</label>
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as 'none' | 'cse')}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="none">None</option>
          <option value="cse">CSE</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <CSEColumn />
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Sentiment</th>
              <th className="px-3 py-2 text-right">ATR</th>
              <th className="px-3 py-2 text-right">ACV Δ</th>
              <th className="px-3 py-2">Renewal</th>
              <th className="px-3 py-2 text-center">Hygiene</th>
              <th className="px-3 py-2">Last Sentiment Update</th>
            </tr>
          </thead>
          <tbody>
            {groupBy === 'cse' && groupedData ? (
              cseNames.map(cseName => {
                const groupViews = groupedData.get(cseName) || [];
                const isExpanded = expandedGroups.has(cseName);
                const totalATR = groupViews.reduce((s, v) => s + v.atrUSD, 0);
                const totalACVDelta = groupViews.reduce((s, v) => s + v.opportunities.reduce((acc, o) => acc + (o.acvDelta ?? 0), 0), 0);

                return (
                  <React.Fragment key={cseName}>
                    {/* Group header */}
                    <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200" onClick={() => toggleGroup(cseName)}>
                      <td className="px-3 py-2 font-semibold" colSpan={11}>
                        <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                        {cseName} ({groupViews.length} accounts)
                        <span className="ml-4 text-gray-600">
                          ATR: {fmtUSD(totalATR)} | ACV Δ: {fmtUSD(totalACVDelta)}
                        </span>
                      </td>
                    </tr>
                    {/* Group rows */}
                    {isExpanded && groupViews.map(v => <AccountRow key={v.account.accountId} v={v} showCSE={false} />)}
                  </React.Fragment>
                );
              })
            ) : (
              views.map(v => <AccountRow key={v.account.accountId} v={v} showCSE={true} />)
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Sorted by Manager Priority. Default rank uses bucket → Risk Category → days to renewal → ATR.</p>
    </>
  );
}

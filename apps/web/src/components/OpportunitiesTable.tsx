'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import React from 'react';
import { fmtUSD } from '@/components/ui';
import type { CanonicalOpportunity, CanonicalAccount } from '@mdas/canonical';

type SortField = 'cse' | 'account' | 'opportunity' | 'stage' | 'type' | 'product' | 'fy' | 'qtr' | 'acv' | 'acvDelta' | 'forecastHedge' | 'forecast' | 'forecastOverride' | 'flmNotes' | 'closeDate';
type SortDirection = 'asc' | 'desc';

interface OpportunitiesTableProps {
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, CanonicalAccount>;
}

export function OpportunitiesTable({ opportunities, accounts }: OpportunitiesTableProps) {
  const [sortField, setSortField] = useState<SortField>('closeDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
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

  // Sort opportunities
  const sortedOpps = useMemo(() => {
    let result = [...opportunities];

    // Apply sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortField) {
        case 'cse':
          const cseA = a.salesEngineer?.name ?? 'Unassigned';
          const cseB = b.salesEngineer?.name ?? 'Unassigned';
          aVal = cseA;
          bVal = cseB;
          break;
        case 'account':
          aVal = accounts.get(a.accountId)?.accountName || a.accountId;
          bVal = accounts.get(b.accountId)?.accountName || b.accountId;
          break;
        case 'opportunity':
          aVal = a.opportunityName;
          bVal = b.opportunityName;
          break;
        case 'stage':
          aVal = a.stageNum || 0;
          bVal = b.stageNum || 0;
          break;
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'product':
          aVal = a.productLine || '';
          bVal = b.productLine || '';
          break;
        case 'fy':
          aVal = a.fiscalYear;
          bVal = b.fiscalYear;
          break;
        case 'qtr':
          aVal = a.closeQuarter.replace('Q', '');
          bVal = b.closeQuarter.replace('Q', '');
          break;
        case 'acv':
          aVal = a.acv || 0;
          bVal = b.acv || 0;
          break;
        case 'acvDelta':
          aVal = a.acvDelta || 0;
          bVal = b.acvDelta || 0;
          break;
        case 'forecastHedge':
          aVal = a.forecastHedgeUSD || 0;
          bVal = b.forecastHedgeUSD || 0;
          break;
        case 'forecast':
          aVal = a.forecastMostLikely || 0;
          bVal = b.forecastMostLikely || 0;
          break;
        case 'forecastOverride':
          aVal = a.forecastMostLikelyOverride || 0;
          bVal = b.forecastMostLikelyOverride || 0;
          break;
        case 'flmNotes':
          aVal = a.flmNotes || '';
          bVal = b.flmNotes || '';
          break;
        case 'closeDate':
          aVal = new Date(a.closeDate).getTime();
          bVal = new Date(b.closeDate).getTime();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [opportunities, accounts, sortField, sortDirection]);

  // Group by CSE
  const { groupedData, cseNames } = useMemo(() => {
    if (groupBy === 'none') {
      return { groupedData: null, cseNames: [] };
    }

    const groups = new Map<string, typeof opportunities>();
    const names = new Set<string>();

    sortedOpps.forEach(opp => {
      const cseName = opp.salesEngineer?.name ?? 'Unassigned';
      names.add(cseName);
      if (!groups.has(cseName)) {
        groups.set(cseName, []);
      }
      groups.get(cseName)!.push(opp);
    });

    return {
      groupedData: groups,
      cseNames: Array.from(names).sort()
    };
  }, [sortedOpps, groupBy]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-300">↕</span>;
    return sortDirection === 'asc' ? <span className="text-gray-600">↑</span> : <span className="text-gray-600">↓</span>;
  };

  const OpportunityRow = ({ opp, showCSE }: { opp: CanonicalOpportunity; showCSE: boolean }) => {
    const account = accounts.get(opp.accountId);
    const cseName = opp.salesEngineer?.name ?? '—';
    const accountName = account?.accountName || opp.accountId;

    return (
      <tr key={opp.opportunityId} className="border-t border-gray-100 hover:bg-gray-50">
        {showCSE && (
          <td className="px-3 py-2 text-gray-700 font-medium">{cseName}</td>
        )}
        <td className="px-3 py-2 font-medium">
          <Link href={`/accounts/${opp.accountId}`} className="hover:underline">
            {accountName}
          </Link>
        </td>
        <td className="px-3 py-2 font-medium">
          {opp.opportunityName}
        </td>
        <td className="px-3 py-2 text-gray-700">{opp.stageName}</td>
        <td className="px-3 py-2 text-gray-700">{opp.type}</td>
        <td className="px-3 py-2 text-gray-700">{opp.productLine ?? '—'}</td>
        <td className="px-3 py-2 text-gray-700">{opp.fiscalYear}</td>
        <td className="px-3 py-2 text-gray-700">
          {opp.closeQuarter.startsWith('Q') ? opp.closeQuarter : `Q${opp.closeQuarter}`}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{opp.acv ? fmtUSD(opp.acv) : '—'}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${
          opp.acvDelta && opp.acvDelta < 0 ? 'text-red-700' :
          opp.acvDelta && opp.acvDelta > 0 ? 'text-green-700' : 'text-gray-600'
        }`}>
          {opp.acvDelta ? fmtUSD(opp.acvDelta) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{opp.forecastHedgeUSD ? fmtUSD(opp.forecastHedgeUSD) : '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {opp.forecastMostLikely ? fmtUSD(opp.forecastMostLikely) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {opp.forecastMostLikelyOverride ? fmtUSD(opp.forecastMostLikelyOverride) : '—'}
        </td>
        <td className="px-3 py-2 text-gray-700 text-xs max-w-xs truncate">{opp.flmNotes || '—'}</td>
        <td className="px-3 py-2 text-gray-700">{new Date(opp.closeDate).toLocaleDateString()}</td>
        <td className="px-3 py-2">
          {(() => {
            const sfLink = opp.sourceLinks?.find((l) => l.source === 'salesforce');
            const url = sfLink?.url ?? `https://zuora.lightning.force.com/lightning/r/Opportunity/${opp.opportunityId}/view`;
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                View
              </a>
            );
          })()}
        </td>
      </tr>
    );
  };

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
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('cse')}>
                CSE <SortIcon field="cse" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('account')}>
                Account <SortIcon field="account" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('opportunity')}>
                Opportunity <SortIcon field="opportunity" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('stage')}>
                Stage <SortIcon field="stage" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('type')}>
                Type <SortIcon field="type" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('product')}>
                Product <SortIcon field="product" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('fy')}>
                FY <SortIcon field="fy" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('qtr')}>
                Qtr <SortIcon field="qtr" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('acv')}>
                ACV <SortIcon field="acv" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('acvDelta')}>
                ACV Δ <SortIcon field="acvDelta" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('forecastHedge')}>
                Forecast Hedge <SortIcon field="forecastHedge" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('forecast')}>
                Forecast (ML) <SortIcon field="forecast" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('forecastOverride')}>
                Forecast Override <SortIcon field="forecastOverride" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('flmNotes')}>
                FLM Notes <SortIcon field="flmNotes" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('closeDate')}>
                Close Date <SortIcon field="closeDate" />
              </th>
              <th className="px-3 py-2">Salesforce</th>
            </tr>
          </thead>
          <tbody>
            {groupBy === 'cse' && groupedData ? (
              cseNames.map(cseName => {
                const groupOpps = groupedData.get(cseName) || [];
                const isExpanded = expandedGroups.has(cseName);
                const totalACV = groupOpps.reduce((s, o) => s + (o.acv || 0), 0);
                const totalACVDelta = groupOpps.reduce((s, o) => s + (o.acvDelta || 0), 0);
                const totalForecast = groupOpps.reduce((s, o) => s + (o.forecastMostLikely || 0), 0);

                return (
                  <React.Fragment key={cseName}>
                    <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200" onClick={() => toggleGroup(cseName)}>
                      <td className="px-3 py-2 font-semibold" colSpan={15}>
                        <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                        {cseName} ({groupOpps.length} opportunities)
                        <span className="ml-4 text-gray-600">
                          ACV: {fmtUSD(totalACV)} | ACV Δ: {fmtUSD(totalACVDelta)} | Forecast: {fmtUSD(totalForecast)}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && groupOpps.map(opp => <OpportunityRow key={opp.opportunityId} opp={opp} showCSE={false} />)}
                  </React.Fragment>
                );
              })
            ) : (
              sortedOpps.map(opp => <OpportunityRow key={opp.opportunityId} opp={opp} showCSE={true} />)
            )}
          </tbody>
        </table>
      </div>

      {sortedOpps.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No opportunities found
        </div>
      )}

      <p className="text-xs text-gray-500">
        Showing {sortedOpps.length} of {opportunities.length} opportunities with close dates within 15 months trailing to 36 months forward from today. Click headers to sort.
      </p>
    </>
  );
}

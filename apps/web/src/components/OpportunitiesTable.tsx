'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { fmtUSD } from '@/components/ui';
import type { CanonicalOpportunity } from '@mdas/canonical';

type SortField = 'account' | 'opportunity' | 'stage' | 'type' | 'product' | 'fy' | 'qtr' | 'acv' | 'forecast' | 'acvDelta' | 'confidence' | 'closeDate';
type SortDirection = 'asc' | 'desc';

interface OpportunitiesTableProps {
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, string>;
}

export function OpportunitiesTable({ opportunities, accounts }: OpportunitiesTableProps) {
  const [sortField, setSortField] = useState<SortField>('closeDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Sort opportunities
  const sortedOpps = useMemo(() => {
    let result = [...opportunities];

    // Apply sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'account':
          aVal = accounts.get(a.accountId) || a.accountId;
          bVal = accounts.get(b.accountId) || b.accountId;
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
        case 'forecast':
          aVal = a.forecastMostLikely || 0;
          bVal = b.forecastMostLikely || 0;
          break;
        case 'acvDelta':
          aVal = a.acvDelta || 0;
          bVal = b.acvDelta || 0;
          break;
        case 'confidence':
          const confOrder = { 'Low': 0, 'Medium': 1, 'High': 2, 'Confirmed': 3, 'Closed': 4 };
          aVal = confOrder[a.mostLikelyConfidence as keyof typeof confOrder] ?? -1;
          bVal = confOrder[b.mostLikelyConfidence as keyof typeof confOrder] ?? -1;
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

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
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
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('forecast')}>
                Forecast (ML) <SortIcon field="forecast" />
              </th>
              <th className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('acvDelta')}>
                ACV Δ <SortIcon field="acvDelta" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('confidence')}>
                Confidence <SortIcon field="confidence" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('closeDate')}>
                Close Date <SortIcon field="closeDate" />
              </th>
              <th className="px-3 py-2">Salesforce</th>
            </tr>
          </thead>
          <tbody>
            {sortedOpps.map((opp) => {
              const accountName = accounts.get(opp.accountId) || opp.accountId;
              return (
                <tr key={opp.opportunityId} className="border-t border-gray-100 hover:bg-gray-50">
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {opp.forecastMostLikely ? fmtUSD(opp.forecastMostLikely) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    opp.acvDelta && opp.acvDelta < 0 ? 'text-red-700' : 
                    opp.acvDelta && opp.acvDelta > 0 ? 'text-green-700' : 'text-gray-600'
                  }`}>
                    {opp.acvDelta ? fmtUSD(opp.acvDelta) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {opp.mostLikelyConfidence ? (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        opp.mostLikelyConfidence === 'Confirmed' ? 'bg-green-100 text-green-800' :
                        opp.mostLikelyConfidence === 'High' ? 'bg-blue-100 text-blue-800' :
                        opp.mostLikelyConfidence === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                        opp.mostLikelyConfidence === 'Low' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {opp.mostLikelyConfidence}
                      </span>
                    ) : '—'}
                  </td>
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
            })}
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

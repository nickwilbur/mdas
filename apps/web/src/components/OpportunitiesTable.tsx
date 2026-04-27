'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import React from 'react';
import { fmtUSD } from '@/components/ui';
import { TableHeader, type SortDirection } from '@/components/TableHeader';
import type { CanonicalOpportunity, CanonicalAccount } from '@mdas/canonical';

type SortField =
  | 'cse'
  | 'account'
  | 'opportunity'
  | 'stage'
  | 'type'
  | 'product'
  | 'fy'
  | 'qtr'
  | 'acv'
  | 'acvDelta'
  | 'forecastHedge'
  | 'forecast'
  | 'forecastOverride'
  | 'flmNotes'
  | 'closeDate';

interface OpportunitiesTableProps {
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, CanonicalAccount>;
}

const CLOSED_STAGE_NUMS = new Set([8, 9]);

export function OpportunitiesTable({ opportunities, accounts }: OpportunitiesTableProps) {
  const [sortField, setSortField] = useState<SortField>('closeDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [groupBy, setGroupBy] = useState<'none' | 'cse'>('cse');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Per-column filter state (extensible — add filters by registering Sets here)
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [fyFilter, setFyFilter] = useState<Set<string>>(new Set());
  const [qtrFilter, setQtrFilter] = useState<Set<string>>(new Set());
  const [cseFilter, setCseFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');

  // Distinct values for filter options
  const filterOptions = useMemo(() => {
    const stages = new Map<number, string>();
    const types = new Set<string>();
    const products = new Set<string>();
    const fys = new Set<number>();
    const qtrs = new Set<string>();
    const cses = new Set<string>();
    opportunities.forEach((o) => {
      if (o.stageNum !== null && !stages.has(o.stageNum)) stages.set(o.stageNum, o.stageName);
      if (o.type) types.add(o.type);
      if (o.productLine) products.add(o.productLine);
      if (o.fiscalYear) fys.add(o.fiscalYear);
      const q = o.closeQuarter.startsWith('Q') ? o.closeQuarter : `Q${o.closeQuarter}`;
      qtrs.add(q);
      cses.add(o.salesEngineer?.name ?? 'Unassigned');
    });
    return {
      stages: Array.from(stages.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([num, name]) => ({ value: String(num), label: name })),
      types: Array.from(types).sort().map((v) => ({ value: v, label: v })),
      products: Array.from(products).sort().map((v) => ({ value: v, label: v })),
      fys: Array.from(fys).sort((a, b) => a - b).map((v) => ({ value: String(v), label: String(v) })),
      qtrs: Array.from(qtrs).sort().map((v) => ({ value: v, label: v })),
      cses: Array.from(cses).sort().map((v) => ({ value: v, label: v })),
    };
  }, [opportunities]);

  // Apply filters
  const filteredOpps = useMemo(() => {
    return opportunities.filter((o) => {
      // Stage filter — if empty, default to excluding stage 0
      if (stageFilter.size > 0) {
        if (o.stageNum === null || !stageFilter.has(String(o.stageNum))) return false;
      } else {
        if (o.stageNum === 0) return false;
      }
      // Status (open/all)
      if (statusFilter === 'open' && o.stageNum !== null && CLOSED_STAGE_NUMS.has(o.stageNum)) {
        return false;
      }
      // Type
      if (typeFilter.size > 0 && !typeFilter.has(o.type)) return false;
      // Product
      if (productFilter.size > 0 && !productFilter.has(o.productLine ?? '')) return false;
      // FY
      if (fyFilter.size > 0 && !fyFilter.has(String(o.fiscalYear))) return false;
      // Quarter
      const q = o.closeQuarter.startsWith('Q') ? o.closeQuarter : `Q${o.closeQuarter}`;
      if (qtrFilter.size > 0 && !qtrFilter.has(q)) return false;
      // CSE
      if (cseFilter.size > 0 && !cseFilter.has(o.salesEngineer?.name ?? 'Unassigned')) return false;
      return true;
    });
  }, [opportunities, stageFilter, statusFilter, typeFilter, productFilter, fyFilter, qtrFilter, cseFilter]);

  // Sort
  const sortedOpps = useMemo(() => {
    const result = [...filteredOpps];
    result.sort((a, b) => {
      let aVal: string | number = 0;
      let bVal: string | number = 0;
      switch (sortField) {
        case 'cse':
          aVal = a.salesEngineer?.name ?? 'Unassigned';
          bVal = b.salesEngineer?.name ?? 'Unassigned';
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
          aVal = a.stageNum ?? 0;
          bVal = b.stageNum ?? 0;
          break;
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'product':
          aVal = a.productLine ?? '';
          bVal = b.productLine ?? '';
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
          aVal = a.acv ?? 0;
          bVal = b.acv ?? 0;
          break;
        case 'acvDelta':
          aVal = a.acvDelta ?? 0;
          bVal = b.acvDelta ?? 0;
          break;
        case 'forecastHedge':
          aVal = a.forecastHedgeUSD ?? 0;
          bVal = b.forecastHedgeUSD ?? 0;
          break;
        case 'forecast':
          aVal = a.forecastMostLikely ?? 0;
          bVal = b.forecastMostLikely ?? 0;
          break;
        case 'forecastOverride':
          aVal = a.forecastMostLikelyOverride ?? 0;
          bVal = b.forecastMostLikelyOverride ?? 0;
          break;
        case 'flmNotes':
          aVal = a.flmNotes ?? '';
          bVal = b.flmNotes ?? '';
          break;
        case 'closeDate':
          aVal = new Date(a.closeDate).getTime();
          bVal = new Date(b.closeDate).getTime();
          break;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [filteredOpps, accounts, sortField, sortDirection]);

  // Group by CSE
  const { groupedData, cseNames } = useMemo(() => {
    if (groupBy === 'none') return { groupedData: null, cseNames: [] };
    const groups = new Map<string, typeof filteredOpps>();
    const names = new Set<string>();
    sortedOpps.forEach((opp) => {
      const cseName = opp.salesEngineer?.name ?? 'Unassigned';
      names.add(cseName);
      if (!groups.has(cseName)) groups.set(cseName, []);
      groups.get(cseName)!.push(opp);
    });
    return { groupedData: groups, cseNames: Array.from(names).sort() };
  }, [sortedOpps, groupBy]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleGroup = (cseName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cseName)) next.delete(cseName);
      else next.add(cseName);
      return next;
    });
  };

  const OpportunityRow = ({ opp, showCSE }: { opp: CanonicalOpportunity; showCSE: boolean }) => {
    const account = accounts.get(opp.accountId);
    const cseName = opp.salesEngineer?.name ?? '—';
    const accountName = account?.accountName || opp.accountId;
    return (
      <tr className="border-t border-gray-100 hover:bg-gray-50">
        {showCSE && <td className="px-3 py-2 font-medium text-gray-700">{cseName}</td>}
        <td className="px-3 py-2 font-medium">
          <Link href={`/accounts/${opp.accountId}`} className="hover:underline">
            {accountName}
          </Link>
        </td>
        <td className="px-3 py-2 font-medium">{opp.opportunityName}</td>
        <td className="px-3 py-2 text-gray-700">{opp.stageName}</td>
        <td className="px-3 py-2 text-gray-700">{opp.type}</td>
        <td className="px-3 py-2 text-gray-700">{opp.productLine ?? '—'}</td>
        <td className="px-3 py-2 text-gray-700">{opp.fiscalYear}</td>
        <td className="px-3 py-2 text-gray-700">
          {opp.closeQuarter.startsWith('Q') ? opp.closeQuarter : `Q${opp.closeQuarter}`}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{opp.acv != null ? fmtUSD(opp.acv) : '—'}</td>
        <td
          className={`px-3 py-2 text-right tabular-nums ${
            opp.acvDelta && opp.acvDelta < 0
              ? 'text-red-700'
              : opp.acvDelta && opp.acvDelta > 0
              ? 'text-green-700'
              : 'text-gray-600'
          }`}
        >
          {opp.acvDelta != null ? fmtUSD(opp.acvDelta) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {opp.forecastHedgeUSD != null ? fmtUSD(opp.forecastHedgeUSD) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {opp.forecastMostLikely != null ? fmtUSD(opp.forecastMostLikely) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {opp.forecastMostLikelyOverride != null ? fmtUSD(opp.forecastMostLikelyOverride) : '—'}
        </td>
        <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-700">{opp.flmNotes || '—'}</td>
        <td className="px-3 py-2 text-gray-700">{new Date(opp.closeDate).toLocaleDateString()}</td>
        <td className="px-3 py-2">
          {(() => {
            const sfLink = opp.sourceLinks?.find((l) => l.source === 'salesforce');
            const url =
              sfLink?.url ?? `https://zuora.lightning.force.com/lightning/r/Opportunity/${opp.opportunityId}/view`;
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                View
              </a>
            );
          })()}
        </td>
      </tr>
    );
  };

  // Common header props passed via spread
  const commonHeader = {
    sortField,
    sortDirection,
    onSort: handleSort,
  };

  return (
    <>
      {/* Top-bar: filters that are NOT per-column (status & grouping) */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'open' | 'all')}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="open">Open (not closed)</option>
            <option value="all">All (incl. closed)</option>
          </select>
        </div>
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
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
              <TableHeader<SortField> {...commonHeader} label="Opportunity" field="opportunity" />
              <TableHeader<SortField>
                {...commonHeader}
                label="Stage"
                field="stage"
                filterOptions={filterOptions.stages}
                selectedFilters={stageFilter}
                onFilterChange={setStageFilter}
              />
              <TableHeader<SortField>
                {...commonHeader}
                label="Type"
                field="type"
                filterOptions={filterOptions.types}
                selectedFilters={typeFilter}
                onFilterChange={setTypeFilter}
              />
              <TableHeader<SortField>
                {...commonHeader}
                label="Product"
                field="product"
                filterOptions={filterOptions.products}
                selectedFilters={productFilter}
                onFilterChange={setProductFilter}
              />
              <TableHeader<SortField>
                {...commonHeader}
                label="FY"
                field="fy"
                filterOptions={filterOptions.fys}
                selectedFilters={fyFilter}
                onFilterChange={setFyFilter}
              />
              <TableHeader<SortField>
                {...commonHeader}
                label="Qtr"
                field="qtr"
                filterOptions={filterOptions.qtrs}
                selectedFilters={qtrFilter}
                onFilterChange={setQtrFilter}
              />
              <TableHeader<SortField> {...commonHeader} label="ACV" field="acv" align="right" />
              <TableHeader<SortField> {...commonHeader} label="ACV Δ" field="acvDelta" align="right" />
              <TableHeader<SortField>
                {...commonHeader}
                label="Forecast Hedge"
                field="forecastHedge"
                align="right"
              />
              <TableHeader<SortField> {...commonHeader} label="Forecast (ML)" field="forecast" align="right" />
              <TableHeader<SortField>
                {...commonHeader}
                label="Forecast Override"
                field="forecastOverride"
                align="right"
              />
              <TableHeader<SortField> {...commonHeader} label="FLM Notes" field="flmNotes" />
              <TableHeader<SortField> {...commonHeader} label="Close Date" field="closeDate" />
              <TableHeader<SortField> {...commonHeader} label="Salesforce" />
            </tr>
          </thead>
          <tbody>
            {groupBy === 'cse' && groupedData ? (
              cseNames.map((cseName) => {
                const groupOpps = groupedData.get(cseName) || [];
                const isExpanded = expandedGroups.has(cseName);
                const totalACV = groupOpps.reduce((s, o) => s + (o.acv || 0), 0);
                const totalACVDelta = groupOpps.reduce((s, o) => s + (o.acvDelta || 0), 0);
                const totalForecast = groupOpps.reduce((s, o) => s + (o.forecastMostLikely || 0), 0);
                return (
                  <React.Fragment key={cseName}>
                    <tr
                      className="cursor-pointer bg-gray-100 hover:bg-gray-200"
                      onClick={() => toggleGroup(cseName)}
                    >
                      <td className="px-3 py-2 font-semibold" colSpan={15}>
                        <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                        {cseName} ({groupOpps.length} opportunities)
                        <span className="ml-4 font-normal text-gray-600">
                          ACV: {fmtUSD(totalACV)} | ACV Δ: {fmtUSD(totalACVDelta)} | Forecast:{' '}
                          {fmtUSD(totalForecast)}
                        </span>
                      </td>
                    </tr>
                    {isExpanded &&
                      groupOpps.map((opp) => (
                        <OpportunityRow key={opp.opportunityId} opp={opp} showCSE={false} />
                      ))}
                  </React.Fragment>
                );
              })
            ) : (
              sortedOpps.map((opp) => <OpportunityRow key={opp.opportunityId} opp={opp} showCSE={true} />)
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
        Showing {sortedOpps.length} of {opportunities.length} opportunities. Click headers to sort, use the
        funnel icons to filter. Stage 0 is excluded by default.
      </p>
    </>
  );
}

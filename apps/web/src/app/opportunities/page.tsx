import Link from 'next/link';
import { getAllOpportunities } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { OpportunityFilters } from '@/components/OpportunityFilters';
import { fmtUSD } from '@/components/ui';
import type { CanonicalOpportunity } from '@mdas/canonical';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; q?: string }>;
}) {
  const { fy, q } = await searchParams;
  const { opportunities, accounts } = await getAllOpportunities();
  
  // Filter by fiscal year and quarter if provided
  const filteredOpps = opportunities.filter(opp => {
    if (fy && opp.fiscalYear !== parseInt(fy)) return false;
    if (q) {
      // Normalize quarter values - handle both "1" and "Q1" formats
      const oppQ = opp.closeQuarter.replace('Q', '');
      const filterQ = q.replace('Q', '');
      if (oppQ !== filterQ) return false;
    }
    return true;
  });

  // Get unique fiscal years for filters
  const fiscalYears = Array.from(new Set(opportunities.map(o => o.fiscalYear))).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Opportunities</h1>
        <RefreshButton />
      </div>

      <OpportunityFilters fiscalYears={fiscalYears} />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Opportunity</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">FY</th>
              <th className="px-3 py-2">Qtr</th>
              <th className="px-3 py-2 text-right">ACV</th>
              <th className="px-3 py-2 text-right">Forecast (ML)</th>
              <th className="px-3 py-2 text-right">ACV Δ</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Close Date</th>
              <th className="px-3 py-2">Salesforce</th>
            </tr>
          </thead>
          <tbody>
            {filteredOpps.map((opp) => {
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
                    {opp.sourceLinks.find(l => l.source === 'salesforce') ? (
                      <a 
                        href={opp.sourceLinks.find(l => l.source === 'salesforce')!.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredOpps.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No opportunities found
        </div>
      )}

      <p className="text-xs text-gray-500">
        Showing all opportunities sorted by close date.
      </p>
    </div>
  );
}

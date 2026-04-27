import { getAllOpportunities } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { OpportunityFilters } from '@/components/OpportunityFilters';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';

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

      <OpportunitiesTable opportunities={filteredOpps} accounts={accounts} />
    </div>
  );
}

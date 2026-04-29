import { getAllOpportunities } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { fiscalQuarterFromDate, parseQuartersParam } from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const { opportunities, accounts } = await getAllOpportunities();

  // Build the set of quarter keys actually present in this dataset so
  // the dropdown can grey out empty options.
  const availableQuarterKeys = Array.from(
    new Set(
      opportunities
        .map((o) => fiscalQuarterFromDate(o.closeDate)?.key)
        .filter((k): k is string => !!k),
    ),
  );

  const selectedQuarters = parseQuartersParam(quarters);
  const filteredOpps =
    selectedQuarters === null
      ? opportunities
      : opportunities.filter((opp) => {
          const fq = fiscalQuarterFromDate(opp.closeDate);
          return fq ? selectedQuarters.has(fq.key) : false;
        });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Opportunities</h1>
        <RefreshButton />
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />

      <OpportunitiesTable opportunities={filteredOpps} accounts={accounts} />
    </div>
  );
}

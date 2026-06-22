import Link from 'next/link';
import { getAllOpportunities } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import {
  fiscalQuarterFromDate,
  parseQuartersParam,
  resolveQuarterBucket,
  scopeQuartersToBucket,
} from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string; bucket?: string; focus?: string }>;
}) {
  const { quarters, bucket: bucketParam, focus } = await searchParams;
  const { opportunities, accounts } = await getAllOpportunities();
  const bucket = resolveQuarterBucket(bucketParam, 'prospective');

  // Build the set of quarter keys actually present in this dataset so
  // the dropdown can grey out empty options.
  const availableQuarterKeys = Array.from(
    new Set(
      opportunities
        .map((o) => fiscalQuarterFromDate(o.closeDate)?.key)
        .filter((k): k is string => !!k),
    ),
  );

  const scopeQuarters = scopeQuartersToBucket(parseQuartersParam(quarters), bucket);
  let displayOpps = opportunities.filter((opp) => {
    const fq = fiscalQuarterFromDate(opp.closeDate);
    return fq ? scopeQuarters.has(fq.key) : false;
  });

  // Deep-link from renewal dashboard — always show the focused opp even if
  // quarter filter would exclude it.
  if (focus) {
    const focused = opportunities.find((o) => o.opportunityId === focus);
    if (focused) displayOpps = [focused];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Opportunities</h1>
          {focus && displayOpps.length === 1 ? (
            <p className="text-xs text-gray-500">
              Focused renewal ·{' '}
              <Link href="/opportunities" className="text-blue-700 hover:underline">
                Show all
              </Link>
            </p>
          ) : null}
        </div>
        <RefreshButton />
      </div>

      {!focus ? (
        <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} defaultBucket="prospective" />
      ) : null}

      <OpportunitiesTable
        opportunities={displayOpps}
        accounts={accounts}
        focusOpportunityId={focus ?? undefined}
      />
    </div>
  );
}

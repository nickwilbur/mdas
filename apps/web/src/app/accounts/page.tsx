import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { BucketBadge, RiskBadge, SentimentBadge, fmtUSD } from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';
import { AccountsTable } from '@/components/AccountsTable';
import { AccountFilters } from '@/components/AccountFilters';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const { views } = await getDashboardData();

  // Get unique fiscal quarters from opportunities
  const fiscalQuarters = Array.from(
    new Set(
      views.flatMap(v => v.opportunities.map(o => o.closeQuarter))
    )
  ).sort();

  // Filter by fiscal quarters if provided
  const filteredViews = quarters
    ? views.filter(v => {
        const accountQuarters = new Set(v.opportunities.map(o => o.closeQuarter));
        const selectedQuarters = quarters.split(',');
        return selectedQuarters.some(q => accountQuarters.has(q));
      })
    : views;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
        <RefreshButton />
      </div>

      <AccountFilters fiscalQuarters={fiscalQuarters} />

      <AccountsTable views={filteredViews} />
    </div>
  );
}

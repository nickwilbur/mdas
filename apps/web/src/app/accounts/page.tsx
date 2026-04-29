import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { BucketBadge, RiskBadge, SentimentBadge, fmtUSD } from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';
import { AccountsTable } from '@/components/AccountsTable';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const { views } = await getDashboardData();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
        <RefreshButton />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Franchise:</label>
        <select
          disabled
          className="rounded border border-gray-300 px-2 py-1 text-sm bg-gray-50"
        >
          <option>Expand 3</option>
        </select>
      </div>

      <AccountsTable views={views} />
    </div>
  );
}

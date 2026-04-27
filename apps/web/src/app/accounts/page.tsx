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

      <AccountsTable views={views} />
    </div>
  );
}

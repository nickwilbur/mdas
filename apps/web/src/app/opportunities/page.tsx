import { getAllOpportunities } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';

export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  const { opportunities, accounts } = await getAllOpportunities();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Opportunities</h1>
        <RefreshButton />
      </div>

      <OpportunitiesTable opportunities={opportunities} accounts={accounts} />
    </div>
  );
}

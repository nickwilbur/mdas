import { getDashboardData } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { AccountsTable } from '@/components/AccountsTable';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { fiscalQuartersForAccount, parseQuartersParam } from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const { views } = await getDashboardData();

  const availableQuarterKeys = Array.from(
    new Set(views.flatMap((v) => fiscalQuartersForAccount(v))),
  );

  const selectedQuarters = parseQuartersParam(quarters);
  const filteredViews =
    selectedQuarters === null
      ? views
      : views.filter((v) => {
          const ks = fiscalQuartersForAccount(v);
          return ks.some((k) => selectedQuarters.has(k));
        });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
        <RefreshButton />
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />

      <AccountsTable views={filteredViews} />
    </div>
  );
}

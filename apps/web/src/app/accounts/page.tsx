import { getDashboardData } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { AccountsTable } from '@/components/AccountsTable';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import {
  fiscalQuartersForAccount,
  parseQuartersParam,
  resolveQuarterBucket,
  scopeQuartersToBucket,
} from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string; bucket?: string }>;
}) {
  const { quarters, bucket: bucketParam } = await searchParams;
  const { views } = await getDashboardData();
  const bucket = resolveQuarterBucket(bucketParam, 'prospective');

  const availableQuarterKeys = Array.from(
    new Set(views.flatMap((v) => fiscalQuartersForAccount(v))),
  );

  const scopeQuarters = scopeQuartersToBucket(parseQuartersParam(quarters), bucket);
  const filteredViews = views.filter((v) => {
    const ks = fiscalQuartersForAccount(v);
    return ks.some((k) => scopeQuarters.has(k));
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
        <RefreshButton />
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} defaultBucket="prospective" />

      <AccountsTable views={filteredViews} />
    </div>
  );
}

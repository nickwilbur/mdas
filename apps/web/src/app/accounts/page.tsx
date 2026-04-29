import { getDashboardData } from '@/lib/read-model';
import { RefreshButton } from '@/components/RefreshButton';
import { AccountsTable } from '@/components/AccountsTable';
import { AccountFilters } from '@/components/AccountFilters';
import { fiscalQuarterFromDate } from '@/lib/fiscal';
import type { AccountView } from '@mdas/canonical';

export const dynamic = 'force-dynamic';

/**
 * Determine the fiscal quarter(s) an account belongs to for filtering.
 * - Confirmed Churn → use account.churnDate
 * - Saveable Risk / Healthy → use opportunity close dates
 */
function quartersForAccount(v: AccountView): string[] {
  if (v.bucket === 'Confirmed Churn') {
    const fq = fiscalQuarterFromDate(v.account.churnDate);
    return fq ? [fq.key] : [];
  }
  const keys = new Set<string>();
  for (const o of v.opportunities) {
    const fq = fiscalQuarterFromDate(o.closeDate);
    if (fq) keys.add(fq.key);
  }
  return Array.from(keys);
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const { views } = await getDashboardData();

  // Build the union of quarter keys across both axes (close date + churn date).
  const quarterMap = new Map<string, string>();
  for (const v of views) {
    for (const k of quartersForAccount(v)) {
      if (!quarterMap.has(k)) {
        const [fy, q] = k.split('-');
        quarterMap.set(k, `FY${fy.slice(-2)} ${q}`);
      }
    }
  }
  const quarterOptions = Array.from(quarterMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, label]) => ({ key, label }));

  // Apply filter. Empty/missing param = all.
  const selectedQuarters = quarters
    ? new Set(quarters.split(',').filter(Boolean))
    : null;

  const filteredViews = selectedQuarters
    ? views.filter((v) => {
        const ks = quartersForAccount(v);
        if (ks.length === 0) return false;
        return ks.some((k) => selectedQuarters.has(k));
      })
    : views;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
        <RefreshButton />
      </div>

      <AccountFilters quarterOptions={quarterOptions} />

      <AccountsTable views={filteredViews} />
    </div>
  );
}

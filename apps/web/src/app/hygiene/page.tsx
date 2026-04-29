import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { Card } from '@/components/ui';
import { HygieneFilters } from './HygieneClient';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { fiscalQuartersForAccount, parseQuartersParam } from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

export default async function HygienePage({
  searchParams,
}: {
  searchParams: Promise<{ violationTypes?: string; quarters?: string }>;
}) {
  const { violationTypes, quarters } = await searchParams;
  const { views: allViews } = await getDashboardData();

  // 1. Apply fiscal quarter filter first (cross-page contract).
  const selectedQuarters = parseQuartersParam(quarters);
  const availableQuarterKeys = Array.from(
    new Set(allViews.flatMap((v) => fiscalQuartersForAccount(v))),
  );
  const quarterFilteredViews =
    selectedQuarters === null
      ? allViews
      : allViews.filter((v) => {
          const ks = fiscalQuartersForAccount(v);
          return ks.some((k) => selectedQuarters.has(k));
        });

  // 2. Then derive violation types from the quarter-filtered slice so
  //    counts in the dropdown reflect the visible scope.
  const violationTypeMap = new Map<string, number>();
  for (const v of quarterFilteredViews) {
    for (const h of v.hygiene.violations) {
      const count = violationTypeMap.get(h.rule) ?? 0;
      violationTypeMap.set(h.rule, count + 1);
    }
  }
  const violationOptions = Array.from(violationTypeMap.entries())
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count);

  // 3. Apply violation type filter on top.
  const selectedViolationTypes = violationTypes
    ? new Set(violationTypes.split(',').filter(Boolean))
    : null;

  const filteredViews = selectedViolationTypes
    ? quarterFilteredViews.filter((v) =>
        v.hygiene.violations.some((h) => selectedViolationTypes.has(h.rule))
      )
    : quarterFilteredViews;

  const byCSE = new Map<string, { count: number; accounts: { id: string; name: string; n: number }[] }>();
  for (const v of filteredViews) {
    if (v.hygiene.score === 0) continue;
    const cse = v.account.assignedCSE?.name ?? 'Unassigned';
    const r = byCSE.get(cse) ?? { count: 0, accounts: [] };
    r.count += v.hygiene.score;
    r.accounts.push({ id: v.account.accountId, name: v.account.accountName, n: v.hygiene.score });
    byCSE.set(cse, r);
  }
  const cseEntries = [...byCSE.entries()].sort((a, b) => b[1].count - a[1].count);

  // Filter violations in the table based on selection
  const allViolations = filteredViews.flatMap((v) =>
    v.hygiene.violations.map((h) => ({ ...h, account: v.account }))
  );

  const filteredViolations = selectedViolationTypes
    ? allViolations.filter((h) => selectedViolationTypes.has(h.rule))
    : allViolations;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Hygiene Worklist</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />
        <HygieneFilters violationOptions={violationOptions} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {cseEntries.map(([cse, r]) => (
          <Card key={cse} title={`@${cse} — ${r.count} violations`}>
            <ul className="space-y-1 text-sm">
              {r.accounts
                .sort((a, b) => b.n - a.n)
                .map((a) => (
                  <li key={a.id} className="flex justify-between">
                    <Link href={`/accounts/${a.id}`} className="hover:underline">{a.name}</Link>
                    <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">{a.n}</span>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card title={`All hygiene violations (${filteredViolations.length})`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">CSE</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Rule</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Coaching prompt</th>
            </tr>
          </thead>
          <tbody>
            {filteredViolations.map((h, i) => (
              <tr key={`${h.account.accountId}-${i}`} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700">{h.account.assignedCSE?.name ?? '—'}</td>
                <td className="px-3 py-2 font-medium">
                  <Link href={`/accounts/${h.account.accountId}`} className="hover:underline">
                    {h.account.accountName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{h.rule}</span>{' '}
                  {h.confidence === 'low' && (
                    <span className="text-[10px] uppercase text-gray-500">low conf</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700">{h.description}</td>
                <td className="px-3 py-2 italic text-gray-700">{h.coachingPrompt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

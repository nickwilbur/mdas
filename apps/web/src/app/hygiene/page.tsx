import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function HygienePage() {
  const { views } = await getDashboardData();

  const byCSE = new Map<string, { count: number; accounts: { id: string; name: string; n: number }[] }>();
  for (const v of views) {
    if (v.hygiene.score === 0) continue;
    const cse = v.account.assignedCSE?.name ?? 'Unassigned';
    const r = byCSE.get(cse) ?? { count: 0, accounts: [] };
    r.count += v.hygiene.score;
    r.accounts.push({ id: v.account.accountId, name: v.account.accountName, n: v.hygiene.score });
    byCSE.set(cse, r);
  }
  const cseEntries = [...byCSE.entries()].sort((a, b) => b[1].count - a[1].count);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Hygiene Worklist</h1>

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

      <Card title="All hygiene violations">
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
            {views.flatMap((v) =>
              v.hygiene.violations.map((h, i) => (
                <tr key={`${v.account.accountId}-${i}`} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700">{v.account.assignedCSE?.name ?? '—'}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/accounts/${v.account.accountId}`} className="hover:underline">
                      {v.account.accountName}
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
              )),
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

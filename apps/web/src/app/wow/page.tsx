import Link from 'next/link';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import { Card } from '@/components/ui';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { fiscalQuartersForAccount, parseQuartersParam } from '@/lib/fiscal';
import type { ChangeEvent } from '@mdas/canonical';

export const dynamic = 'force-dynamic';

const CATEGORIES: { key: ChangeEvent['category']; title: string }[] = [
  { key: 'risk', title: 'Risk movements' },
  { key: 'sentiment', title: 'Sentiment movements' },
  { key: 'forecast', title: 'Forecast movements' },
  { key: 'hygiene', title: 'Hygiene movements' },
  { key: 'workshop', title: 'New workshops' },
  { key: 'churn-notice', title: 'Churn notices submitted' },
];

export default async function WoWPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  const [{ events, prevId, currId }, { views }] = await Promise.all([
    getWoWChangeEvents(),
    getDashboardData(),
  ]);

  // Map accountId → quarter keys so we can filter events by account's
  // fiscal quarter membership (closeDate / churnDate).
  const accountQuartersMap = new Map<string, string[]>();
  for (const v of views) {
    accountQuartersMap.set(v.account.accountId, fiscalQuartersForAccount(v));
  }
  const availableQuarterKeys = Array.from(
    new Set(views.flatMap((v) => fiscalQuartersForAccount(v))),
  );

  const selectedQuarters = parseQuartersParam(quarters);
  const filteredEvents =
    selectedQuarters === null
      ? events
      : events.filter((e) => {
          const ks = accountQuartersMap.get(e.accountId) ?? [];
          return ks.some((k) => selectedQuarters.has(k));
        });

  const groups = new Map<string, ChangeEvent[]>();
  for (const e of filteredEvents) {
    const list = groups.get(e.category) ?? [];
    list.push(e);
    groups.set(e.category, list);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Week-over-Week Changes</h1>
      <p className="text-xs text-gray-500">
        Diff between {prevId ? prevId.slice(0, 8) : '—'} and {currId ? currId.slice(0, 8) : '—'} ({filteredEvents.length} of {events.length} events)
      </p>
      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CATEGORIES.map(({ key, title }) => {
          const list = groups.get(key) ?? [];
          return (
            <Card key={key} title={`${title} (${list.length})`}>
              <ul className="space-y-1 text-sm">
                {list.length === 0 && <li className="text-gray-500">None.</li>}
                {list.map((e, i) => (
                  <li key={i} className="border-b border-gray-100 py-1">
                    <Link href={`/accounts/${e.accountId}`} className="hover:underline">{e.label}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { getDashboardData, getWoWChangeEvents, DEFAULT_WINDOW_DAYS } from '@/lib/read-model';
import { Card } from '@/components/ui';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import { WindowSelector } from '@/components/WindowSelector';
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function WoWPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string; window?: string }>;
}) {
  const { quarters, window: windowParam } = await searchParams;
  const windowDays = [7, 14, 30].includes(Number(windowParam)) ? Number(windowParam) : DEFAULT_WINDOW_DAYS;
  const [{ events, baselineDate, windowDays: wd }, { views }] = await Promise.all([
    getWoWChangeEvents(windowDays),
    getDashboardData(windowDays),
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Changes</h1>
          <p className="text-xs text-gray-500">
            {baselineDate
              ? `Since ${formatDate(baselineDate)} (${wd}d window) — ${filteredEvents.length} events`
              : `No baseline found for ${wd}d window`}
          </p>
        </div>
        <WindowSelector current={windowDays} />
      </div>
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

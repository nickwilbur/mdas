// MovementsStrip — compressed WoW summary for the dashboard top panel.
//
// Audit ref: F-04 in docs/audit/01_findings.md.
//
// Renders one row per ChangeEvent.category with a count and a
// click-through to the existing /wow page. Keeps the primary attention
// on the ActionQueue while still surfacing the "what changed this week"
// answer in the first 10 seconds.
import Link from 'next/link';
import type { ChangeEvent } from '@mdas/canonical';

const CATEGORIES: { key: ChangeEvent['category']; label: string; tone: string }[] = [
  { key: 'churn-notice', label: 'Churn notices', tone: 'bg-red-50 text-red-800 border-red-200' },
  { key: 'risk', label: 'Risk movements', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  { key: 'sentiment', label: 'Sentiment movements', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'forecast', label: 'Forecast movements', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  { key: 'hygiene', label: 'Hygiene', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  { key: 'workshop', label: 'New workshops', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
];

function formatBaselineDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MovementsStrip({
  events,
  baselineDate,
  windowDays,
}: {
  events: ChangeEvent[];
  baselineDate: string | null;
  windowDays: number;
}): JSX.Element {
  const counts = new Map<ChangeEvent['category'], number>();
  for (const e of events) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  const total = events.length;
  if (!baselineDate) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
        No prior refresh to diff against — movements will appear after another refresh outside the {windowDays}-day window.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-end justify-between">
        <h2 className="text-sm font-semibold">
          Movements since {formatBaselineDate(baselineDate)}
          <span className="ml-1 text-xs font-normal text-gray-500">({windowDays}d window)</span>
        </h2>
        <Link href={`/wow${windowDays !== 7 ? `?window=${windowDays}` : ''}`} className="text-xs text-blue-700 hover:underline">
          See all {total} →
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {CATEGORIES.map((c) => {
          const n = counts.get(c.key) ?? 0;
          return (
            <li
              key={c.key}
              className={`rounded border px-2 py-1 ${c.tone} ${n === 0 ? 'opacity-50' : ''}`}
            >
              <div className="text-[10px] uppercase tracking-wide">{c.label}</div>
              <div className="text-lg font-semibold tabular-nums">{n}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

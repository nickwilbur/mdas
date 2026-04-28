import clsx from 'clsx';
import type { ReactNode } from 'react';
import type {
  AdapterSource,
  CerebroRiskCategory,
  CSESentiment,
  GainsightTask,
  SourceFreshnessMap,
} from '@mdas/canonical';

export const fmtUSD = (n: number | null | undefined) =>
  n == null ? '—' : n === 0 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;

export function RiskBadge({
  level,
  source,
}: {
  level: CerebroRiskCategory | 'Unknown';
  source: 'cerebro' | 'fallback';
}) {
  const colors: Record<string, string> = {
    Critical: 'bg-red-600 text-white',
    High: 'bg-orange-600 text-white',
    Medium: 'bg-yellow-500 text-black',
    Low: 'bg-green-600 text-white',
    Unknown: 'bg-gray-400 text-white',
  };
  const text = level ?? 'Unknown';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('rounded px-2 py-0.5 text-xs font-semibold', colors[text])}>
        {text}
      </span>
      <span className="text-[10px] uppercase text-gray-500">via {source}</span>
    </span>
  );
}

export function SentimentBadge({ value }: { value: CSESentiment }) {
  const colors: Record<string, string> = {
    Green: 'bg-green-100 text-green-800 ring-green-300',
    Yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-300',
    Red: 'bg-red-100 text-red-800 ring-red-300',
    'Confirmed Churn': 'bg-black text-white ring-gray-700',
  };
  if (!value) return <span className="text-gray-400">—</span>;
  return (
    <span className={clsx('rounded px-2 py-0.5 text-xs ring-1', colors[value])}>{value}</span>
  );
}

export function BucketBadge({ bucket }: { bucket: string }) {
  const colors: Record<string, string> = {
    'Confirmed Churn': 'bg-black text-white',
    'Saveable Risk': 'bg-orange-100 text-orange-800 ring-1 ring-orange-300',
    Healthy: 'bg-green-100 text-green-800 ring-1 ring-green-300',
  };
  return <span className={clsx('rounded px-2 py-0.5 text-xs', colors[bucket])}>{bucket}</span>;
}

export function UpsellBandBadge({ band, score }: { band: string; score: number }) {
  const colors: Record<string, string> = {
    Hot: 'bg-pink-600 text-white',
    Active: 'bg-violet-600 text-white',
    Qualified: 'bg-blue-100 text-blue-800',
    Watch: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', colors[band])}>
      {band} {score}
    </span>
  );
}

export function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-gray-500">{sub}</div> : null}
    </div>
  );
}

/**
 * Render an ISO timestamp as a relative time ("3h ago", "yesterday", "5d ago")
 * with the absolute time available on hover via title attribute. Returns "—"
 * when the input is null/empty.
 */
export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-gray-400">—</span>;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return <span className="text-gray-400">—</span>;
  const now = Date.now();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (diffMs < 0) label = 'in the future';
  else if (minutes < 1) label = 'just now';
  else if (minutes < 60) label = `${minutes}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else if (days === 1) label = 'yesterday';
  else if (days < 30) label = `${days}d ago`;
  else label = new Date(iso).toLocaleDateString();
  return (
    <span title={new Date(iso).toLocaleString()} className="tabular-nums">
      {label}
    </span>
  );
}

/**
 * Per-source freshness pill row. Each adapter that ran for this record
 * stamps `lastFetchedFromSource[source] = ISO timestamp`. We render one
 * colored pill per entry. Stale (>7d) entries dim. Missing entries omitted.
 *
 * Pass `expectedSources` to render a placeholder pill for sources that
 * SHOULD have run but did not (the adapter is enabled but emitted no
 * data for this account, or the adapter wasn't enabled at all).
 */
export function FreshnessRow({
  freshness,
  expectedSources,
}: {
  freshness: SourceFreshnessMap | undefined;
  expectedSources?: AdapterSource[];
}) {
  const entries = Object.entries(freshness ?? {}) as [AdapterSource, string][];
  const present = new Set<AdapterSource>(entries.map(([k]) => k));
  const missing = (expectedSources ?? []).filter((s) => !present.has(s));

  if (entries.length === 0 && missing.length === 0) return null;

  const stale = (iso: string): boolean =>
    Date.now() - new Date(iso).getTime() > 7 * 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, iso]) => (
          <span
            key={source}
            title={`Last fetched from ${source}: ${new Date(iso).toLocaleString()}`}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
              stale(iso)
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800',
            )}
          >
            <span className="font-semibold">{source}</span>
            <RelativeTime iso={iso} />
          </span>
        ))}
      {missing.map((source) => (
        <span
          key={source}
          title={`No fresh data from ${source} on this account this refresh`}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-500"
        >
          <span className="font-semibold">{source}</span>
          <span>no data</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Gainsight Task list (CTAs). Surfaces owner, due date, status, and a
 * deep-link to the Gainsight CTA when available. Open tasks render with
 * a status dot; closed render dimmed.
 */
export function GainsightTaskList({
  tasks,
  sourceLinkByCtaId,
}: {
  tasks: GainsightTask[];
  /** Map of ctaId → URL, harvested from CanonicalAccount.sourceLinks. */
  sourceLinkByCtaId?: Map<string, string>;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-gray-500">No Gainsight tasks for this account.</p>;
  }
  const isClosed = (s: string) => /^closed/i.test(s);
  return (
    <ul className="space-y-2 text-sm">
      {tasks.map((t) => {
        const closed = isClosed(t.status);
        const url = t.ctaId ? sourceLinkByCtaId?.get(t.ctaId) : undefined;
        return (
          <li
            key={t.id}
            className={clsx(
              'flex items-start justify-between gap-2 border-b border-gray-100 py-1.5',
              closed && 'text-gray-400',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    closed ? 'bg-gray-300' : 'bg-blue-500',
                  )}
                />
                {url ? (
                  <a href={url} className="truncate font-medium text-blue-700 hover:underline">
                    {t.title}
                  </a>
                ) : (
                  <span className="truncate font-medium">{t.title}</span>
                )}
              </div>
              {t.owner ? (
                <div className="ml-3.5 text-xs text-gray-600">Owner: {t.owner.name}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span
                className={clsx(
                  'rounded px-1.5 py-0.5 text-[10px] uppercase',
                  closed
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                )}
              >
                {t.status}
              </span>
              {t.dueDate ? (
                <span className="text-[10px] text-gray-500">
                  due {t.dueDate.slice(0, 10)}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

import clsx from 'clsx';
import type { ReactNode } from 'react';
import type {
  AdapterSource,
  CerebroRiskCategory,
  CSESentiment,
  GainsightTask,
  SourceErrorMap,
  SourceFreshnessMap,
  SourceLink,
} from '@mdas/canonical';
import { isStale, relativeTimeLabel } from './time';

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

// PR-B1: composite Risk Score badge.
//
// Renders the 0–100 score and band, plus a low-confidence indicator
// when Cerebro Risk Category is missing (so the user knows the score
// is directional, not authoritative). The colors are deliberately a
// shade darker than RiskBadge to differentiate them at a glance —
// the two badges live next to each other in many places.
const RISK_SCORE_BAND_COLORS: Record<string, string> = {
  Critical: 'bg-red-700 text-white',
  High: 'bg-orange-700 text-white',
  Medium: 'bg-amber-500 text-black',
  Low: 'bg-emerald-700 text-white',
};

export function RiskScoreBadge({
  score,
  band,
  confidence,
  showLabel = false,
}: {
  score: number;
  band: 'Low' | 'Medium' | 'High' | 'Critical';
  confidence: 'high' | 'low';
  /** When true, prepends 'Score' before the number — useful inline. */
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={clsx(
          'rounded px-2 py-0.5 text-xs font-semibold tabular-nums',
          RISK_SCORE_BAND_COLORS[band] ?? 'bg-gray-400 text-white',
        )}
        title={`Composite risk score: ${score} (${band})`}
      >
        {showLabel ? `Score ${score}` : score} · {band}
      </span>
      {confidence === 'low' ? (
        <span
          className="rounded border border-gray-300 px-1 py-0.5 text-[10px] uppercase text-gray-500"
          title="Cerebro Risk Category is missing for this account; treat the score as directional only."
        >
          low conf
        </span>
      ) : null}
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
  const label = relativeTimeLabel(iso);
  if (label === '—') return <span className="text-gray-400">—</span>;
  return (
    <span title={iso ? new Date(iso).toLocaleString() : ''} className="tabular-nums">
      {label}
    </span>
  );
}

/**
 * Per-source freshness pill row. Each adapter that ran for this record
 * stamps `lastFetchedFromSource[source] = ISO timestamp`. We render one
 * pill per entry, color-coded:
 *
 *   - emerald   : fresh data from this source (≤ 7d)
 *   - amber     : data older than 7d (stale)
 *   - red       : adapter ran but reported a non-fatal error this refresh
 *                 (the field set this source owns may be partial / stale)
 *   - gray "no data" : the source is in `expectedSources` but absent
 *                 from `freshness` AND `errors` (adapter not enabled,
 *                 or emitted nothing for this account)
 */
export function FreshnessRow({
  freshness,
  errors,
  expectedSources,
}: {
  freshness: SourceFreshnessMap | undefined;
  errors?: SourceErrorMap;
  expectedSources?: AdapterSource[];
}) {
  const entries = Object.entries(freshness ?? {}) as [AdapterSource, string][];
  const errorEntries = Object.entries(errors ?? {}) as [AdapterSource, string][];
  const present = new Set<AdapterSource>([
    ...entries.map(([k]) => k),
    ...errorEntries.map(([k]) => k),
  ]);
  const missing = (expectedSources ?? []).filter((s) => !present.has(s));

  if (entries.length === 0 && errorEntries.length === 0 && missing.length === 0) {
    return null;
  }

  const errorBySource = new Map(errorEntries);

  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, iso]) => {
          const errMsg = errorBySource.get(source);
          if (errMsg) {
            return (
              <span
                key={source}
                title={`Adapter "${source}" reported an error this refresh: ${errMsg}`}
                className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-red-800"
              >
                <span className="font-semibold">{source}</span>
                <span aria-label="error">⚠</span>
                <RelativeTime iso={iso} />
              </span>
            );
          }
          return (
            <span
              key={source}
              title={`Last fetched from ${source}: ${new Date(iso).toLocaleString()}`}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                isStale(iso)
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800',
              )}
            >
              <span className="font-semibold">{source}</span>
              <RelativeTime iso={iso} />
            </span>
          );
        })}
      {/* Errored-but-no-freshness case: source failed before producing any data. */}
      {errorEntries
        .filter(([source]) => !freshness || !(source in freshness))
        .map(([source, msg]) => (
          <span
            key={source}
            title={`Adapter "${source}" failed this refresh: ${msg}`}
            className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-red-800"
          >
            <span className="font-semibold">{source}</span>
            <span aria-label="error">⚠</span>
            <span>error</span>
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
 * Compact per-source data-completeness indicator: one small glyph per
 * `expectedSources` entry. Useful in tables where a full FreshnessRow
 * would be too tall.
 *
 * Audit ref: F-07 in docs/audit/01_findings.md.
 *
 * State conveyance is BOTH color AND shape so the indicator works for
 * the ~8% of users with red/green color-blindness and screen readers:
 *
 *   - emerald ●  : fresh data from this source (≤ 7d)
 *   - amber   ◐  : stale (> 7d)
 *   - red     ✕  : adapter reported a non-fatal error this refresh
 *   - gray    ○  : source missing from `freshness` and `errors`
 *
 * Each glyph is wrapped with role="img" + aria-label carrying the
 * source name and the human-readable state, so a screen reader
 * announces "salesforce, fresh" rather than nothing.
 */
type SourceDotState = 'fresh' | 'stale' | 'error' | 'missing';

const SOURCE_DOT_GLYPH: Record<SourceDotState, string> = {
  fresh: '●',
  stale: '◐',
  error: '✕',
  missing: '○',
};

const SOURCE_DOT_TONE: Record<SourceDotState, string> = {
  fresh: 'text-emerald-600',
  stale: 'text-amber-600',
  error: 'text-red-600',
  missing: 'text-gray-400',
};

export function SourceDots({
  freshness,
  errors,
  expectedSources,
}: {
  freshness: SourceFreshnessMap | undefined;
  errors?: SourceErrorMap;
  expectedSources: AdapterSource[];
}) {
  return (
    <div className="inline-flex gap-1">
      {expectedSources.map((source) => {
        const iso = freshness?.[source];
        const errMsg = errors?.[source];
        let state: SourceDotState;
        let stateLabel: string;
        let title: string;
        if (errMsg) {
          state = 'error';
          stateLabel = 'error';
          title = `${source}: error — ${errMsg}`;
        } else if (iso) {
          if (isStale(iso)) {
            state = 'stale';
            stateLabel = 'stale';
          } else {
            state = 'fresh';
            stateLabel = 'fresh';
          }
          title = `${source}: ${new Date(iso).toLocaleString()}`;
        } else {
          state = 'missing';
          stateLabel = 'no data';
          title = `${source}: no data this refresh`;
        }
        return (
          <span
            key={source}
            title={title}
            role="img"
            aria-label={`${source}, ${stateLabel}`}
            className={clsx(
              'inline-block w-3 text-center text-xs font-bold leading-none',
              SOURCE_DOT_TONE[state],
            )}
          >
            {SOURCE_DOT_GLYPH[state]}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Render a flat list of SourceLinks grouped by source. Each group has a
 * heading with a count badge; within a group, links are sorted by label.
 * Citation links (those with citationId / snippetIndex) get a small
 * "📍" indicator so a reader knows the URL anchors to a specific snippet.
 */
export function SourceLinksGrouped({ links }: { links: SourceLink[] }) {
  if (links.length === 0) {
    return <p className="text-sm text-gray-500">No source links.</p>;
  }
  // Stable bucketing.
  const groups = new Map<string, SourceLink[]>();
  for (const l of links) {
    const arr = groups.get(l.source);
    if (arr) arr.push(l);
    else groups.set(l.source, [l]);
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-3">
      {sortedGroups.map(([source, items]) => (
        <div key={source}>
          <h3 className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            <span>{source}</span>
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
              {items.length}
            </span>
          </h3>
          <ul className="grid grid-cols-1 gap-0.5 text-sm sm:grid-cols-2">
            {items
              .slice()
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((l, i) => {
                const isCitation =
                  typeof l.citationId === 'string' || typeof l.snippetIndex === 'number';
                return (
                  <li key={`${source}-${i}`} className="truncate">
                    <a
                      href={l.url}
                      className="text-blue-700 hover:underline"
                      title={l.url}
                    >
                      {l.label}
                    </a>
                    {isCitation ? (
                      <span
                        className="ml-1 align-middle text-[10px] text-gray-500"
                        title={`Citation: ${l.citationId ?? ''}#${l.snippetIndex ?? 0}`}
                      >
                        📍
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </div>
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

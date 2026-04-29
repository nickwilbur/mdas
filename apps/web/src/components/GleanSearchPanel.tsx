'use client';

// GleanSearchPanel — reusable search box + result list.
//
// Used in two places:
//  1. /glean (full-page Glean workspace, "Search" tab).
//  2. GleanCommandBar (cmd-K overlay; passes `compact` to drop the
//     datasource chips into a single line and shrink padding).
//
// Renders results as cards with title, datasource pill, snippet, and
// click-through to the Glean web UI. Each click is a normal anchor —
// since the user is already SSO'd into Glean via Okta, the link
// resolves directly without a fresh login. We deliberately do NOT
// render a "preview body" inline by default (that costs an extra
// /api/glean/document round-trip and most clicks just want to open
// the doc). A lightweight "Preview" button exposes the inline body
// when the user opts in.
import { useEffect, useRef, useState } from 'react';
import { Search, ExternalLink, Eye, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface SearchResult {
  title: string;
  url: string;
  datasource: string;
  snippet: string;
  updateTime: string | null;
  citationId: string | null;
}

interface PreviewDoc {
  url: string;
  title: string;
  content: string;
}

const DATASOURCE_PRESETS: { id: string; label: string; sources: string[] | null }[] = [
  { id: 'all', label: 'All', sources: null },
  { id: 'docs', label: 'Docs', sources: ['gdrive', 'confluence', 'notion'] },
  { id: 'people', label: 'People', sources: ['gmail', 'slack', 'googlecalendar'] },
  { id: 'cerebro', label: 'Cerebro', sources: ['cerebro'] },
  { id: 'salesforce', label: 'Salesforce', sources: ['salescloud'] },
  { id: 'gainsight', label: 'Gainsight', sources: ['gainsight'] },
];

export interface GleanSearchPanelProps {
  /** Optional initial query — used when the drill-in pre-fills with account name. */
  initialQuery?: string;
  /** Compact layout (used inside the command bar overlay). */
  compact?: boolean;
  /** Callback fired when the user picks a result (used by the command bar to close itself). */
  onSelectResult?: (r: SearchResult) => void;
  /** Auto-focus the input on mount (default: true). */
  autoFocus?: boolean;
}

export function GleanSearchPanel({
  initialQuery = '',
  compact = false,
  onSelectResult,
  autoFocus = true,
}: GleanSearchPanelProps): JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [presetId, setPresetId] = useState<string>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Map<string, PreviewDoc>>(new Map());
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Auto-search if an initial query was passed in (drill-in entry point).
  // We use a ref-tracked latch so a parent re-rendering with the same
  // initialQuery doesn't re-fire the search.
  const initialFiredRef = useRef(false);
  useEffect(() => {
    if (initialQuery && !initialFiredRef.current) {
      initialFiredRef.current = true;
      runSearch(initialQuery, 'all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  async function runSearch(q: string, preset: string): Promise<void> {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const sources =
        DATASOURCE_PRESETS.find((p) => p.id === preset)?.sources ?? null;
      const r = await fetch('/api/glean/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: q,
          datasources: sources,
          pageSize: compact ? 8 : 25,
        }),
        signal: ctrl.signal,
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? `Search failed (${r.status})`);
        setResults([]);
        return;
      }
      setResults(data.results ?? []);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview(url: string, title: string): Promise<void> {
    if (previews.has(url)) {
      // Toggle off
      const next = new Map(previews);
      next.delete(url);
      setPreviews(next);
      return;
    }
    setPreviewLoading(url);
    try {
      const r = await fetch('/api/glean/document', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      });
      const data = await r.json();
      const doc = data.documents?.[0];
      if (doc) {
        const next = new Map(previews);
        next.set(url, { url, title, content: doc.content ?? '' });
        setPreviews(next);
      }
    } finally {
      setPreviewLoading(null);
    }
  }

  return (
    <div className={clsx('space-y-3', !compact && 'space-y-4')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query, presetId);
        }}
        className={clsx(
          'flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3',
          compact ? 'py-1.5' : 'py-2',
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Glean — docs, meetings, slack, gmail…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
          aria-label="Glean search query"
          data-hotkey-search
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-hidden />}
        <button
          type="submit"
          className="rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
          disabled={loading || !query.trim()}
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        {DATASOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPresetId(p.id);
              if (query.trim()) runSearch(query, p.id);
            }}
            className={clsx(
              'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
              presetId === p.id
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !error && results.length === 0 && query.trim() && (
        <p className="text-sm text-gray-500">No results.</p>
      )}

      <ul className={clsx(compact ? 'space-y-1.5' : 'space-y-2', 'max-h-[60vh] overflow-y-auto')}>
        {results.map((r) => {
          const preview = previews.get(r.url);
          return (
            <li
              key={r.url}
              className={clsx(
                'rounded-md border border-gray-200 bg-white p-3 hover:border-gray-400',
                compact && 'p-2',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onSelectResult?.(r)}
                    className="flex items-center gap-1.5 font-medium text-blue-700 hover:underline"
                  >
                    <span className="truncate">{r.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono uppercase">
                      {r.datasource || 'unknown'}
                    </span>
                    {r.updateTime && (
                      <span title={r.updateTime}>
                        {new Date(r.updateTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {r.snippet && (
                    <p className={clsx('mt-1 text-sm text-gray-700', compact && 'line-clamp-2')}>
                      {r.snippet}
                    </p>
                  )}
                </div>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => loadPreview(r.url, r.title)}
                    className="flex shrink-0 items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    {previewLoading === r.url ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Eye className="h-3 w-3" aria-hidden />
                    )}
                    {preview ? 'Hide' : 'Preview'}
                  </button>
                )}
              </div>
              {preview && (
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-800">
                  {preview.content || '(empty body returned)'}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

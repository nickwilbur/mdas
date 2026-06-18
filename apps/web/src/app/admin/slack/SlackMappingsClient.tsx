'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SlackMappingRow } from '@/lib/slack-mapping';

interface PreviewResult {
  previewId: string;
  targetType: 'customer_channel' | 'self_test';
  targetSlackIdOrChannel: string | null;
  accountName: string | null;
  messageBody: string;
  sendAllowed: boolean;
  blockedReason: string | null;
}

interface ConfirmResult {
  ok: boolean;
  auditId: string;
  result: 'sent' | 'blocked' | 'failed';
  failureReason: string | null;
  ts?: string;
}

interface MappingsApiResponse {
  rows: SlackMappingRow[];
  total: number;
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
}

// ───────────────────────────────────────────────────────────────────
// Sort + filter state shape
//
// Single source of truth for what the user has asked for. Mirrored into
// the URL so filters survive reload / can be shared. Mirrored to the
// API request as `?sort=&dir=&...` query string.
//
// `sort` must be one of SORTABLE_COLUMNS (validated server-side in
// buildMappingQuery via the same whitelist). `dir` is 'asc' | 'desc'.
// Filters are all plain strings — empty string means "no filter".
// ───────────────────────────────────────────────────────────────────

type SortColumnId =
  | 'account_name'
  | 'status'
  | 'source'
  | 'channel_name'
  | 'last_refreshed_at';

interface MappingFiltersState {
  status: string;
  source: string;
  q: string;
  channelNameQ: string;
  refreshedAfter: string;
  refreshedBefore: string;
}

const EMPTY_FILTERS: MappingFiltersState = {
  status: '',
  source: '',
  q: '',
  channelNameQ: '',
  refreshedAfter: '',
  refreshedBefore: '',
};

// Column metadata. Drives both the sortable header buttons and the
// filter row underneath. Each entry maps a column id to:
//   - label:    what the user sees in the header
//   - sortable: whether the column header doubles as a sort button
//   - filter:   the kind of input rendered in the filter row
const COLUMNS: ReadonlyArray<{
  id: SortColumnId | 'actions';
  label: string;
  sortable: boolean;
  filter:
    | { kind: 'text'; field: keyof MappingFiltersState; placeholder: string }
    | { kind: 'select'; field: keyof MappingFiltersState; options: ReadonlyArray<string> }
    | { kind: 'daterange'; afterField: keyof MappingFiltersState; beforeField: keyof MappingFiltersState }
    | { kind: 'none' };
}> = [
  {
    id: 'account_name',
    label: 'Account',
    sortable: true,
    filter: { kind: 'text', field: 'q', placeholder: 'name or id…' },
  },
  {
    id: 'status',
    label: 'Status',
    sortable: true,
    filter: {
      kind: 'select',
      field: 'status',
      options: [
        '',
        'mapped',
        'manually_overridden',
        'heuristic_candidate',
        'inaccessible_channel',
        'invalid_slack_url',
        'missing_salesforce_channel',
        'unresolved',
      ],
    },
  },
  {
    id: 'source',
    label: 'Source',
    sortable: true,
    filter: {
      kind: 'select',
      field: 'source',
      options: ['', 'salesforce', 'override', 'sheet', 'heuristic', 'cache'],
    },
  },
  {
    id: 'channel_name',
    label: 'Channel',
    sortable: true,
    filter: { kind: 'text', field: 'channelNameQ', placeholder: 'channel name…' },
  },
  {
    id: 'last_refreshed_at',
    label: 'Last refreshed',
    sortable: true,
    filter: {
      kind: 'daterange',
      afterField: 'refreshedAfter',
      beforeField: 'refreshedBefore',
    },
  },
  { id: 'actions', label: '', sortable: false, filter: { kind: 'none' } },
];

interface Props {
  initialRows: SlackMappingRow[];
  initialTotal: number;
  initialCounts: Record<string, number>;
  initialPage: number;
  pageSize: number;
  statusColors: Record<string, string>;
  sendEnabled: boolean;
  testRecipientConfigured: boolean;
  /**
   * 'bot' | 'user' | 'xoxc' | 'none'. When 'user' or 'xoxc', the
   * heuristic-candidate count reflects channels visible to the
   * operator's personal Slack identity (their public + private
   * membership) — a different operator running the same tool would
   * see a different number. UI surfaces this caveat near the
   * heuristic_candidate tile.
   */
  readTokenKind: 'bot' | 'user' | 'xoxc' | 'none';
}

// Statuses where the per-row "Map URL" button is meaningful. Anything
// that's already `mapped` or `manually_overridden` doesn't need the
// action (operator can still use Clear Override + Map URL to replace).
const NEEDS_MANUAL_RESOLUTION = new Set([
  'heuristic_candidate',
  'unresolved',
  'missing_salesforce_channel',
  'invalid_slack_url',
  'inaccessible_channel',
]);

const STATUS_TILES = [
  'mapped',
  'manually_overridden',
  'heuristic_candidate',
  'inaccessible_channel',
  'invalid_slack_url',
  'missing_salesforce_channel',
  'unresolved',
];

const SOURCE_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  salesforce: {
    label: 'SFDC',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    title: 'Resolved from Salesforce Internal_Customer_Slack_Channel__c',
  },
  override: {
    label: 'override',
    cls: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    title: 'Admin-set manual override',
  },
  sheet: {
    label: 'sheet',
    cls: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
    title: 'Imported from the operational tracker CSV',
  },
  heuristic: {
    label: 'heuristic',
    cls: 'bg-sky-100 text-sky-800 border-sky-300',
    title: 'Derived from cust-{slug} naming convention — verify in Slack',
  },
  cache: {
    label: 'cache',
    cls: 'bg-gray-100 text-gray-700 border-gray-300',
    title: 'Carried forward from a prior refresh (Salesforce field went empty)',
  },
};

export function SlackMappingsClient(props: Props): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The browser holds AT MOST one page (default 50) of mapping rows at any
  // time, plus the lightweight counts histogram. We never accumulate or
  // cache prior pages — switching pages replaces the row array.
  const [rows, setRows] = useState<SlackMappingRow[]>(props.initialRows);
  const [total, setTotal] = useState(props.initialTotal);
  const [counts, setCounts] = useState<Record<string, number>>(props.initialCounts);
  const [page, setPage] = useState(props.initialPage);

  // Filters and sort: initialised from URL query params so a shared link
  // (e.g. /admin/slack?status=inaccessible_channel&sort=last_refreshed_at&dir=desc)
  // restores the same view. Empty defaults mirror the server's defaults.
  const [filters, setFilters] = useState<MappingFiltersState>(() => ({
    status: searchParams.get('status') ?? '',
    source: searchParams.get('source') ?? '',
    q: searchParams.get('q') ?? '',
    channelNameQ: searchParams.get('channelNameQ') ?? '',
    refreshedAfter: searchParams.get('refreshedAfter') ?? '',
    refreshedBefore: searchParams.get('refreshedBefore') ?? '',
  }));
  const [sort, setSort] = useState<SortColumnId>(
    (searchParams.get('sort') as SortColumnId | null) ?? 'account_name',
  );
  const [dir, setDir] = useState<'asc' | 'desc'>(
    searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
  );

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState<string | 'all' | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<SlackMappingRow | null>(null);
  const [, startTransition] = useTransition();

  // Debounce text-filter inputs (250ms) so a 10-char query doesn't trigger
  // 10 fetches. We debounce the WHOLE filters object — select changes
  // (status/source) settle through the same path so the wait is uniform.
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filters), 250);
    return () => clearTimeout(t);
  }, [filters]);

  // Reset to page 1 whenever filters or sort change. A page-3 view of
  // the old filter set is meaningless after the filter shrinks results,
  // and re-sorting puts a different population at the top of the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPage(1);
  }, [debouncedFilters, sort, dir]);

  // Sync to URL so deep links / reloads preserve the view. replace()
  // not push() so the browser back button doesn't have to step through
  // every keystroke.
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedFilters.status) next.set('status', debouncedFilters.status);
    if (debouncedFilters.source) next.set('source', debouncedFilters.source);
    if (debouncedFilters.q) next.set('q', debouncedFilters.q);
    if (debouncedFilters.channelNameQ) next.set('channelNameQ', debouncedFilters.channelNameQ);
    if (debouncedFilters.refreshedAfter) next.set('refreshedAfter', debouncedFilters.refreshedAfter);
    if (debouncedFilters.refreshedBefore) next.set('refreshedBefore', debouncedFilters.refreshedBefore);
    if (sort !== 'account_name') next.set('sort', sort);
    if (dir !== 'asc') next.set('dir', dir);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [debouncedFilters, sort, dir, router]);

  // Aborts the prior fetch when filters change rapidly. Without this a
  // slow first request can land AFTER a fast second one and clobber the
  // visible state with stale rows.
  const abortRef = useRef<AbortController | null>(null);
  const fetchPage = useCallback(
    async (opts: {
      page: number;
      filters: MappingFiltersState;
      sort: SortColumnId;
      dir: 'asc' | 'desc';
      silent?: boolean;
    }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (!opts.silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(opts.page),
          pageSize: String(props.pageSize),
          sort: opts.sort,
          dir: opts.dir,
        });
        if (opts.filters.status) params.set('status', opts.filters.status);
        if (opts.filters.source) params.set('source', opts.filters.source);
        if (opts.filters.q) params.set('q', opts.filters.q);
        if (opts.filters.channelNameQ) params.set('channelNameQ', opts.filters.channelNameQ);
        if (opts.filters.refreshedAfter) params.set('refreshedAfter', opts.filters.refreshedAfter);
        if (opts.filters.refreshedBefore) params.set('refreshedBefore', opts.filters.refreshedBefore);
        const r = await fetch(`/api/slack/mappings?${params.toString()}`, {
          signal: ac.signal,
        });
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        const j = (await r.json()) as MappingsApiResponse;
        setRows(j.rows);
        setTotal(j.total);
        setCounts(j.counts);
        setPage(j.page);
      } catch (e) {
        if ((e as { name?: string }).name !== 'AbortError') {
          setRefreshMsg(`Error: ${(e as Error).message}`);
        }
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [props.pageSize],
  );

  // Re-fetch on page / filters / sort changes. We intentionally don't
  // depend on `fetchPage` itself; it's stable per pageSize.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchPage({ page, filters: debouncedFilters, sort, dir });
  }, [page, debouncedFilters, sort, dir]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Toggle sort column / direction. Click on the current sort column
  // flips asc ↔ desc; click on a different column sets that column to
  // its natural direction (timestamps default to descending so the
  // newest rows surface first; everything else defaults to ascending).
  const toggleSort = useCallback(
    (col: SortColumnId) => {
      if (col === sort) {
        setDir(dir === 'asc' ? 'desc' : 'asc');
      } else {
        setSort(col);
        setDir(col === 'last_refreshed_at' ? 'desc' : 'asc');
      }
    },
    [sort, dir],
  );

  const updateFilter = useCallback(
    (field: keyof MappingFiltersState, value: string) => {
      setFilters((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const clearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v.trim().length > 0).length,
    [filters],
  );

  const refreshAll = useCallback(async () => {
    setRefreshing('all');
    setRefreshMsg('Refreshing all mappings…');
    try {
      const r = await fetch('/api/slack/mappings/refresh', { method: 'POST' });
      const j = await r.json();
      setRefreshMsg(
        `Done — ${j.mapped ?? 0} mapped, ${j.manually_overridden ?? 0} overridden, ` +
          `${j.heuristic_candidate ?? 0} candidates, ${j.inaccessible_channel ?? 0} inaccessible, ` +
          `${j.invalid_slack_url ?? 0} invalid, ${j.changed ?? 0} changed` +
          (j.validated ? `, ${j.validated} Slack-validated` : '') +
          (j.validationErrors ? `, ${j.validationErrors} validation errors` : '') +
          '.',
      );
      await fetchPage({ page: 1, filters: debouncedFilters, sort, dir });
      startTransition(() => router.refresh());
    } catch (e) {
      setRefreshMsg(`Error: ${(e as Error).message}`);
    } finally {
      setRefreshing(null);
    }
  }, [fetchPage, router, debouncedFilters, sort, dir]);

  const refreshOne = useCallback(
    async (accountId: string) => {
      setRefreshing(accountId);
      try {
        await fetch(`/api/slack/mappings/refresh/${encodeURIComponent(accountId)}`, {
          method: 'POST',
        });
        await fetchPage({ page, filters: debouncedFilters, sort, dir, silent: true });
      } finally {
        setRefreshing(null);
      }
    },
    [fetchPage, page, debouncedFilters, sort, dir],
  );

  const setOverride = useCallback(
    async (accountId: string, slackUrl: string) => {
      setRefreshing(accountId);
      try {
        const res = await fetch(
          `/api/slack/mappings/override/${encodeURIComponent(accountId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slackUrl }),
          },
        );
        const body = (await res.json()) as {
          ok: boolean;
          validated?: string;
          slackChannelId?: string;
          reason?: string;
        };
        if (!body.ok) {
          alert(`Override failed: ${body.reason ?? 'unknown error'}`);
        } else if (body.validated === 'inaccessible') {
          alert(
            `Override saved, but Slack reports channel ${body.slackChannelId} as inaccessible.\n` +
              `The row is flagged inaccessible_channel — refresh won't undo it. Use Clear to revert.`,
          );
        }
        await fetchPage({ page, filters: debouncedFilters, sort, dir, silent: true });
      } finally {
        setRefreshing(null);
      }
    },
    [fetchPage, page, debouncedFilters, sort, dir],
  );

  const clearOverride = useCallback(
    async (accountId: string) => {
      if (!confirm('Clear the manual override for this account? Refresh will re-derive the mapping from Salesforce/sheet/heuristic.')) {
        return;
      }
      setRefreshing(accountId);
      try {
        await fetch(
          `/api/slack/mappings/override/${encodeURIComponent(accountId)}`,
          { method: 'DELETE' },
        );
        await fetchPage({ page, filters: debouncedFilters, sort, dir, silent: true });
      } finally {
        setRefreshing(null);
      }
    },
    [fetchPage, page, debouncedFilters, sort, dir],
  );

  const totalPages = Math.max(1, Math.ceil(total / props.pageSize));
  const start = total === 0 ? 0 : (page - 1) * props.pageSize + 1;
  const end = Math.min(total, page * props.pageSize);

  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ sort, dir });
      if (debouncedFilters.status) params.set('status', debouncedFilters.status);
      if (debouncedFilters.source) params.set('source', debouncedFilters.source);
      if (debouncedFilters.q) params.set('q', debouncedFilters.q);
      if (debouncedFilters.channelNameQ) params.set('channelNameQ', debouncedFilters.channelNameQ);
      if (debouncedFilters.refreshedAfter) {
        params.set('refreshedAfter', debouncedFilters.refreshedAfter);
      }
      if (debouncedFilters.refreshedBefore) {
        params.set('refreshedBefore', debouncedFilters.refreshedBefore);
      }
      const r = await fetch(`/api/slack/mappings/export?${params.toString()}`);
      if (!r.ok) throw new Error(`export failed: ${r.status}`);
      const blob = await r.blob();
      const disposition = r.headers.get('Content-Disposition');
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'slack-mappings.csv';
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
      const n = r.headers.get('X-Row-Count');
      setRefreshMsg(n ? `Exported ${n} rows to ${filename}` : `Exported ${filename}`);
    } catch (e) {
      setRefreshMsg(`Export error: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [debouncedFilters, sort, dir]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={refreshAll}
          disabled={refreshing !== null}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
        >
          {refreshing === 'all' ? 'Refreshing…' : 'Refresh all mappings'}
        </button>
        <button
          onClick={() => setShowImport((v) => !v)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          title="Paste CSV from the operational tracker spreadsheet"
        >
          {showImport ? 'Hide CSV import' : 'Import sheet CSV…'}
        </button>
        <button
          onClick={exportCsv}
          disabled={exporting || refreshing !== null}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          title="Download mappings as CSV (respects current filters and sort). Includes mapping source and whether the Salesforce Internal_Customer_Slack_Channel__c field is filled."
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        {refreshMsg ? (
          <span className="text-xs text-gray-700" role="status">
            {refreshMsg}
          </span>
        ) : null}
      </div>

      {showImport ? (
        <SheetImportPanel
          onClose={() => setShowImport(false)}
          onImported={() => {
            // After import, kick a refresh so the new sheet URLs flow
            // into customer_slack_mapping per the precedence rules.
            refreshAll();
            setShowImport(false);
          }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_TILES.map((s) => {
          const active = filters.status === s;
          const n = counts[s] ?? 0;
          const isHeuristic = s === 'heuristic_candidate';
          const personalScope =
            isHeuristic && (props.readTokenKind === 'user' || props.readTokenKind === 'xoxc');
          return (
            <button
              key={s}
              onClick={() => updateFilter('status', active ? '' : s)}
              className={`rounded border px-3 py-2 text-left transition ${
                active
                  ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-300'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
              title={active ? 'Click to clear filter' : `Filter to ${s}`}
            >
              <div className="text-xs text-gray-500">
                {s}
                {personalScope ? (
                  <span
                    className="ml-1 text-[10px] font-medium text-amber-700"
                    title={`Channel index is built from channels visible to your personal Slack identity (${props.readTokenKind === 'xoxc' ? 'xoxc browser session' : 'user token'}). A teammate would see a different count. Candidates here mean: cust-{slug} not found among your visible public + private channels.`}
                  >
                    (you-scoped)
                  </span>
                ) : null}
              </div>
              <div className="text-lg font-semibold">{n}</div>
            </button>
          );
        })}
      </div>
      {props.readTokenKind === 'user' || props.readTokenKind === 'xoxc' ? (
        <p className="text-xs text-gray-500">
          Heuristic resolution uses the public + private channels visible
          to your personal Slack identity (
          {props.readTokenKind === 'xoxc' ? 'xoxc browser session' : 'user token'}
          ). Channels you're not in stay as <code>heuristic_candidate</code>.
          A bot token (phase 1b) would resolve only public channels but
          give every operator the same view.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {activeFilterCount > 0 ? (
          <button
            onClick={clearAllFilters}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
            title="Clear every column filter"
          >
            Clear filters ({activeFilterCount})
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-600">
          <span>
            {start}–{end} of {total}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="tabular-nums">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      </div>

      <div className="rounded border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 text-sm font-semibold">
          <span>
            Mappings — showing {rows.length} of {total}
            {activeFilterCount > 0 ? ' (filtered)' : ''}
            {' · sorted by '}
            <code className="text-xs font-normal text-gray-600">
              {sort} {dir}
            </code>
          </span>
          {loading ? <span className="text-xs font-normal text-gray-500">loading…</span> : null}
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs uppercase text-gray-600 shadow-sm">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.id}
                    className="px-3 py-2 align-bottom"
                    aria-sort={
                      col.sortable && col.id === sort
                        ? dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : col.sortable
                          ? 'none'
                          : undefined
                    }
                    scope="col"
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id as SortColumnId)}
                        className={`flex items-center gap-1 text-left uppercase hover:text-gray-900 ${
                          col.id === sort ? 'font-semibold text-gray-900' : 'text-gray-600'
                        }`}
                        title={
                          col.id === sort
                            ? `Sorting by ${col.label}, ${dir}. Click to flip direction.`
                            : `Sort by ${col.label}`
                        }
                      >
                        {col.label}
                        <SortIndicator
                          active={col.id === sort}
                          dir={col.id === sort ? dir : null}
                        />
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </th>
                ))}
              </tr>
              <tr className="bg-white">
                {COLUMNS.map((col) => (
                  <th
                    key={`f-${col.id}`}
                    className="border-y border-gray-200 px-3 py-1 font-normal"
                  >
                    <FilterCell
                      column={col}
                      filters={filters}
                      onChange={updateFilter}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-gray-500">
                    {total === 0 && activeFilterCount === 0
                      ? 'No mappings yet. Click "Refresh all mappings" to populate from the latest snapshot.'
                      : 'No mappings match the current filter.'}
                  </td>
                </tr>
              ) : null}
              {rows.map((m) => (
                <tr
                  key={m.accountId}
                  className={`border-t border-gray-100 ${
                    selected?.accountId === m.accountId ? 'bg-blue-50' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.accountName ?? m.accountId}</div>
                    <div className="text-xs text-gray-500">
                      {m.franchise ?? '—'} · CSE {m.assignedCSE ?? '—'} · Owner{' '}
                      {m.accountOwner ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        props.statusColors[m.status] ?? 'bg-gray-100'
                      }`}
                    >
                      {m.status}
                    </span>
                    {m.statusReason ? (
                      <div className="mt-1 text-xs text-gray-500">{m.statusReason}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <SourceBadge source={m.source} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <ChannelCell mapping={m} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {new Date(m.lastRefreshedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => refreshOne(m.accountId)}
                        disabled={refreshing !== null}
                        className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {refreshing === m.accountId ? '…' : 'Refresh'}
                      </button>
                      {NEEDS_MANUAL_RESOLUTION.has(m.status) ? (
                        <button
                          onClick={() => {
                            const url = prompt(
                              `Paste the Slack channel URL for "${m.accountName ?? m.accountId}".\n\nExpected shape:\nhttps://zuora.enterprise.slack.com/archives/Cxxxxxxxx\n\n(Right-click the channel name in Slack → Copy link to channel.)`,
                              '',
                            );
                            if (url && url.trim()) setOverride(m.accountId, url.trim());
                          }}
                          disabled={refreshing !== null}
                          title="Manually set the Slack channel URL for this account. Takes precedence over Salesforce."
                          className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          Map URL
                        </button>
                      ) : null}
                      {m.source === 'override' ? (
                        <button
                          onClick={() => clearOverride(m.accountId)}
                          disabled={refreshing !== null}
                          title="Remove the manual override. Refresh will re-derive from Salesforce/sheet/heuristic."
                          className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Clear override
                        </button>
                      ) : null}
                      <button
                        onClick={() => setSelected(m)}
                        className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
                      >
                        Compose
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <ComposePanel
          mapping={selected}
          onClose={() => setSelected(null)}
          sendEnabled={props.sendEnabled}
          testRecipientConfigured={props.testRecipientConfigured}
        />
      ) : null}
    </>
  );
}

function ComposePanel({
  mapping,
  onClose,
  sendEnabled,
  testRecipientConfigured,
}: {
  mapping: SlackMappingRow;
  onClose: () => void;
  sendEnabled: boolean;
  testRecipientConfigured: boolean;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doPreview = useCallback(
    async (targetType: 'customer_channel' | 'self_test') => {
      setBusy(true);
      setError(null);
      setConfirmation(null);
      try {
        const r = await fetch('/api/slack/send/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: mapping.accountId,
            messageBody: message,
            targetType,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'preview failed');
        setPreview(j as PreviewResult);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [mapping.accountId, message],
  );

  const doConfirm = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/slack/send/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      const j = (await r.json()) as ConfirmResult | { error: string };
      if ('error' in j) throw new Error(j.error);
      setConfirmation(j);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [preview]);

  const doCancel = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await fetch('/api/slack/send/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [preview]);

  return (
    <div className="rounded border-2 border-blue-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">
            Compose message → {mapping.accountName ?? mapping.accountId}
          </div>
          <div className="text-xs text-gray-600">
            Mapping status: <strong>{mapping.status}</strong>
            {mapping.slackChannelId ? ` · channel ${mapping.slackChannelId}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-700">
        Message body
      </label>
      <textarea
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setPreview(null);
          setConfirmation(null);
        }}
        rows={6}
        className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
        placeholder="Draft or paste your message here…"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => doPreview('customer_channel')}
          disabled={busy || !message.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Preview → customer channel
        </button>
        <button
          onClick={() => doPreview('self_test')}
          disabled={busy || !message.trim() || !testRecipientConfigured}
          title={
            testRecipientConfigured
              ? 'Send a test copy to the configured Slack DM (SLACK_TEST_USER_ID)'
              : 'SLACK_TEST_USER_ID must be configured to use test mode'
          }
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Preview → test-to-self
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 text-sm font-semibold">
            Preview {preview.targetType === 'self_test' ? '(TEST MODE → DM)' : '(customer channel)'}
          </div>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
            <dt className="text-gray-600">Account:</dt>
            <dd>{preview.accountName ?? mapping.accountId}</dd>
            <dt className="text-gray-600">Target:</dt>
            <dd className="font-mono">
              {preview.targetSlackIdOrChannel ?? <em>none</em>}
            </dd>
            <dt className="text-gray-600">Send allowed:</dt>
            <dd>
              {preview.sendAllowed ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                  yes
                </span>
              ) : (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">
                  no — {preview.blockedReason}
                </span>
              )}
            </dd>
          </dl>
          <pre className="mt-2 whitespace-pre-wrap rounded border border-gray-300 bg-white p-2 text-xs">
            {preview.targetType === 'self_test'
              ? '[TEST MODE — redirected from customer channel] '
              : ''}
            {preview.messageBody}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={doConfirm}
              disabled={busy || !preview.sendAllowed}
              title={
                !sendEnabled
                  ? 'ENABLE_SLACK_SEND must be "true" to confirm a real send'
                  : undefined
              }
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirm send
            </button>
            <button
              onClick={doCancel}
              disabled={busy}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirmation ? (
        <div
          className={`mt-4 rounded border p-3 text-sm ${
            confirmation.result === 'sent'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : confirmation.result === 'blocked'
                ? 'border-red-300 bg-red-50 text-red-900'
                : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          <div className="font-semibold">Result: {confirmation.result}</div>
          {confirmation.failureReason ? (
            <div className="mt-1 text-xs">{confirmation.failureReason}</div>
          ) : null}
          {confirmation.ts ? (
            <div className="mt-1 text-xs">Slack ts: {confirmation.ts}</div>
          ) : null}
          <div className="mt-1 text-xs text-gray-700">Audit id: {confirmation.auditId}</div>
        </div>
      ) : null}
    </div>
  );
}

// Column-header sort glyph. Three visible states:
//   ⇅  inactive (column is sortable but not currently the sort key)
//   ↑  active asc
//   ↓  active desc
// We use plain unicode glyphs rather than an icon library to stay
// dependency-free. The aria-sort attribute on the <th> carries the
// authoritative state for screen readers.
function SortIndicator({
  active,
  dir,
}: {
  active: boolean;
  dir: 'asc' | 'desc' | null;
}): JSX.Element {
  if (!active) {
    return <span className="text-gray-400" aria-hidden="true">⇅</span>;
  }
  return (
    <span className="text-blue-600" aria-hidden="true">
      {dir === 'asc' ? '↑' : '↓'}
    </span>
  );
}

// Per-column filter input rendered in the secondary thead row. Picks
// the right control based on the column's `filter` metadata. All
// controls write back through the same `onChange(field, value)`
// callback so the parent's filter state stays the single source of
// truth.
function FilterCell({
  column,
  filters,
  onChange,
}: {
  column: (typeof COLUMNS)[number];
  filters: MappingFiltersState;
  onChange: (field: keyof MappingFiltersState, value: string) => void;
}): JSX.Element | null {
  const f = column.filter;
  if (f.kind === 'none') return null;
  if (f.kind === 'text') {
    return (
      <input
        type="search"
        value={filters[f.field]}
        onChange={(e) => onChange(f.field, e.target.value)}
        placeholder={f.placeholder}
        aria-label={`Filter by ${column.label}`}
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-normal"
      />
    );
  }
  if (f.kind === 'select') {
    return (
      <select
        value={filters[f.field]}
        onChange={(e) => onChange(f.field, e.target.value)}
        aria-label={`Filter by ${column.label}`}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs font-normal"
      >
        {f.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === '' ? '(all)' : opt}
          </option>
        ))}
      </select>
    );
  }
  // daterange
  return (
    <div className="flex flex-col gap-1">
      <input
        type="date"
        value={filters[f.afterField]}
        onChange={(e) => onChange(f.afterField, e.target.value)}
        aria-label={`${column.label} from`}
        title="Refreshed on or after"
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs font-normal"
      />
      <input
        type="date"
        value={filters[f.beforeField]}
        onChange={(e) => onChange(f.beforeField, e.target.value)}
        aria-label={`${column.label} to`}
        title="Refreshed on or before"
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs font-normal"
      />
    </div>
  );
}

function SourceBadge({ source }: { source: string }): JSX.Element {
  const meta = SOURCE_BADGE[source] ?? {
    label: source,
    cls: 'bg-gray-100 text-gray-700 border-gray-300',
    title: source,
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}
      title={meta.title}
    >
      {meta.label}
    </span>
  );
}

function SheetImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}): JSX.Element {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!csv.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/slack/mappings/import-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      });
      const j = (await r.json()) as {
        imported?: number;
        skipped?: number;
        errors?: { row: number; reason: string }[];
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? 'import failed');
      const errs = j.errors?.length ?? 0;
      setMsg(
        `Imported ${j.imported ?? 0}, skipped ${j.skipped ?? 0}` +
          (errs ? `, ${errs} error(s) — first: ${j.errors![0]!.reason}` : ''),
      );
      if ((j.imported ?? 0) > 0) onImported();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [csv, onImported]);

  return (
    <div className="rounded border-2 border-fuchsia-300 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Import operational tracker CSV</div>
          <div className="text-xs text-gray-600">
            Last-resort source. Required header: <code>account_id,slack_url</code>{' '}
            (optional <code>note</code>). The Salesforce field still wins; the
            sheet only fills accounts where SFDC is empty.
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          Close
        </button>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={8}
        placeholder={'account_id,slack_url,note\n0014u00001zmSSOAA2,https://zuora.slack.com/archives/C0123ABCD,from-ops-tracker'}
        className="w-full rounded border border-gray-300 p-2 font-mono text-xs"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !csv.trim()}
          className="rounded bg-fuchsia-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import CSV'}
        </button>
        {msg ? <span className="text-xs text-gray-700">{msg}</span> : null}
      </div>
    </div>
  );
}

function ChannelCell({ mapping }: { mapping: SlackMappingRow }): JSX.Element {
  const name = mapping.channelName;
  const url = mapping.slackUrl;
  const archived = mapping.isArchived;
  const nameSrc = mapping.channelNameSource;
  const inaccessible = mapping.status === 'inaccessible_channel';

  // No name at all (account_name was empty / unsluggable).
  if (!name && !url) {
    return <span className="text-gray-400">—</span>;
  }

  const linkClasses = 'font-mono text-blue-700 hover:underline';
  // Inaccessible channels render as plain text — never as a clickable
  // anchor. Per the original product requirement ("we shouldn't link
  // to a link that doesn't work"), clicking through to a dead Slack
  // URL takes the user to Slack's confusing sign-in/glitch page,
  // which is worse than not having a link at all.
  const inaccessibleClasses =
    'font-mono text-red-700 line-through cursor-not-allowed select-text';

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {inaccessible ? (
          <span
            className={inaccessibleClasses}
            title={`Inaccessible — Slack reports channel_not_found for ${mapping.slackChannelId}. URL is intentionally not clickable: ${url ?? '(no url)'}`}
          >
            #{name ?? mapping.slackChannelId}
          </span>
        ) : url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={linkClasses}
            title={url}
          >
            #{name ?? mapping.slackChannelId}
          </a>
        ) : (
          <span
            className="font-mono text-sky-800"
            title="No channel id yet — candidate only"
          >
            #{name}
          </span>
        )}
        {inaccessible ? (
          <span
            className="rounded border border-red-400 bg-red-100 px-1 text-[10px] font-semibold uppercase text-red-800"
            title="Slack reports this channel as inaccessible (channel_not_found / dead link). Treated as a sticky terminal state — refresh will not retry; the next refresh will look for a new cust- channel by name."
          >
            inaccessible
          </span>
        ) : null}
        {archived ? (
          <span
            className="rounded border border-red-300 bg-red-50 px-1 text-[10px] font-medium text-red-700"
            title="Slack reports this channel as archived"
          >
            archived
          </span>
        ) : null}
        {nameSrc === 'slack-api' ? (
          <span
            className="rounded border border-emerald-200 bg-emerald-50 px-1 text-[10px] text-emerald-700"
            title="Channel name verified via Slack public-channel directory"
          >
            verified
          </span>
        ) : nameSrc === 'convention' ? (
          <span
            className="rounded border border-gray-200 bg-gray-50 px-1 text-[10px] text-gray-600"
            title="Channel name derived from cust-{slug} convention; not verified against Slack"
          >
            convention
          </span>
        ) : null}
      </div>
      {url && mapping.slackChannelId ? (
        <span className="text-[10px] text-gray-500" title={url}>
          id: {mapping.slackChannelId}
        </span>
      ) : null}
    </div>
  );
}

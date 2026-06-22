'use client';

// Cross-page fiscal quarter filter.
//
// Best-practice design notes:
//   1. URL is the single source of truth (`?quarters=2027-Q1,2027-Q2`).
//      That means filter state is shareable, deep-linkable, and survives
//      a hard reload. localStorage is used ONLY to remember the last
//      explicit selection on the next visit when the URL is empty.
//   2. Default precedence: explicit URL > localStorage > today's quarter.
//      "Today's quarter" guarantees the user always lands on something
//      relevant to the current fiscal period without manual setup.
//   3. One component, one keyboard model. Used identically on Dashboard,
//      Accounts, Opportunities, Hygiene, and WoW pages so the muscle
//      memory transfers.
//   4. Stable option list via `fiscalQuarterFilterOptions()` — history
//      through current + 8 future quarters (rolling), regardless of
//      whether any data falls in those quarters.

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  currentFiscalQuarter,
  defaultFiscalQuarterForBucket,
  fiscalQuarterFilterOptions,
  fiscalQuarterLabel,
  fiscalQuarterOptionsForBucket,
  formatQuarterSelectionLabel,
  resolveQuarterBucket,
  rollingFiscalQuarters,
  type FiscalQuarter,
  type FiscalQuarterBucket,
} from '@/lib/fiscal';

const STORAGE_KEY_BASE = 'mdas:fiscalQuarterFilter';

interface Props {
  /**
   * Quarters that actually have data on this page. Used to grey out
   * empty options without removing them. Pass an empty array to skip
   * the dimming pass.
   */
  availableQuarterKeys?: string[];
  /**
   * Override the default rolling window. Mostly useful for the Forecast
   * page which only forecasts forward.
   */
  windowOptions?: { trailing?: number; forward?: number };
  /**
   * Pin the filter to one bucket and HIDE the toggle. Prospective = current
   * + next 7 (8 total); retrospective = last 8 ended quarters. Quarters never
   * span both buckets. Used by pages that drive the bucket themselves (e.g.
   * Renewal pipeline view tabs).
   */
  quarterBucket?: FiscalQuarterBucket;
  /**
   * Initial bucket when the user-facing Retro/Prospective toggle is shown.
   * Read from `?bucket=` first, then this default. Ignored when
   * `quarterBucket` (fixed) is set.
   */
  defaultBucket?: FiscalQuarterBucket;
  /**
   * Whether to auto-redirect to today's quarter when the URL param is
   * empty AND localStorage is empty. Default: true. The Forecast page
   * sets this false because it manages its own single-quarter state.
   */
  autoDefault?: boolean;
}

export function FiscalQuarterFilter({
  availableQuarterKeys = [],
  windowOptions,
  quarterBucket,
  defaultBucket,
  autoDefault = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The toggle is shown only when the bucket is not pinned but a default
  // bucket was supplied. `activeBucket` is null only for legacy flat usage.
  const bucketParam = searchParams.get('bucket');
  const showBucketToggle = !quarterBucket && defaultBucket !== undefined;
  const activeBucket: FiscalQuarterBucket | null = quarterBucket
    ? quarterBucket
    : defaultBucket !== undefined
      ? resolveQuarterBucket(bucketParam, defaultBucket)
      : null;
  const storageKey = activeBucket
    ? `${STORAGE_KEY_BASE}:${activeBucket}`
    : STORAGE_KEY_BASE;

  const param = searchParams.get('quarters') ?? '';
  const selected = useMemo(
    () => new Set(param ? param.split(',').filter(Boolean) : []),
    [param],
  );

  // Stable option list independent of data — see file header note.
  const options = useMemo<FiscalQuarter[]>(() => {
    if (activeBucket) {
      return fiscalQuarterOptionsForBucket(activeBucket);
    }
    if (windowOptions?.trailing != null || windowOptions?.forward != null) {
      return rollingFiscalQuarters(
        windowOptions?.trailing ?? 4,
        windowOptions?.forward ?? 4,
      );
    }
    return fiscalQuarterFilterOptions({ dataQuarterKeys: availableQuarterKeys });
  }, [activeBucket, windowOptions?.trailing, windowOptions?.forward, availableQuarterKeys]);
  const allKeys = useMemo(() => options.map((o) => o.key), [options]);
  const availableSet = useMemo(
    () => new Set(availableQuarterKeys),
    [availableQuarterKeys],
  );
  const allActive = selected.size === 0;

  // First-visit auto-default. Runs only when URL is empty.
  // Order: localStorage → today's quarter.
  useEffect(() => {
    if (!autoDefault) return;
    if (param !== '') return;
    let next: string | null = null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const arr = JSON.parse(stored) as string[];
        const valid = arr.filter((k) => allKeys.includes(k));
        if (valid.length > 0) next = valid.join(',');
      }
    } catch {
      // ignore parse errors; fall through to default
    }
    if (!next) {
      next = activeBucket
        ? defaultFiscalQuarterForBucket(activeBucket)
        : currentFiscalQuarter().key;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('quarters', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // We deliberately depend only on `param` and `pathname` so the
    // auto-default fires once per page entry. allKeys is stable per
    // window options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, pathname, autoDefault, activeBucket, storageKey]);

  // When the bucket changes, drop any quarters that belong to the other bucket.
  useEffect(() => {
    if (!activeBucket || param === '' || param === '__none__') return;
    const selectedKeys = param.split(',').filter(Boolean);
    const invalid = selectedKeys.some((k) => !allKeys.includes(k));
    if (!invalid) return;
    const valid = selectedKeys.filter((k) => allKeys.includes(k));
    const params = new URLSearchParams(searchParams.toString());
    params.set(
      'quarters',
      valid.length > 0 ? valid.join(',') : defaultFiscalQuarterForBucket(activeBucket),
    );
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBucket, allKeys.join(',')]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const persist = (keys: string[]) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {
      // best-effort persistence; ignore quota errors
    }
  };

  const updateSelection = (next: Set<string>) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === 0) {
      // sentinel — preserve "no quarters" intent without dropping URL
      params.set('quarters', '__none__');
      persist([]);
    } else if (next.size === allKeys.length) {
      params.delete('quarters');
      persist(allKeys);
    } else {
      const arr = Array.from(next).sort();
      params.set('quarters', arr.join(','));
      persist(arr);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const toggle = (key: string) => {
    const base = allActive ? new Set(allKeys) : new Set(selected);
    if (base.has(key)) base.delete(key);
    else base.add(key);
    updateSelection(base);
  };

  const selectAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('quarters');
    persist(allKeys);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const selectToday = () =>
    updateSelection(
      new Set([
        activeBucket
          ? defaultFiscalQuarterForBucket(activeBucket)
          : currentFiscalQuarter().key,
      ]),
    );

  // Flip the bucket: switch lens and reset the quarter selection to "all in
  // bucket" so past and future are never mixed.
  const setBucket = (next: FiscalQuarterBucket) => {
    if (next === activeBucket) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('bucket', next);
    params.delete('quarters');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const bucketHint =
    activeBucket === 'prospective'
      ? 'Current + next 7 quarters'
      : activeBucket === 'retrospective'
        ? 'Last 8 completed quarters'
        : null;

  const triggerLabel = (() => {
    if (allActive) return quarterBucket ? `All ${allKeys.length} quarters` : 'All Quarters';
    if (selected.size === 0) return 'None';
    if (selected.size === 1) {
      const only = [...selected][0] ?? '';
      return fiscalQuarterLabel(only);
    }
    if (selected.size === allKeys.length) return 'All Quarters';
    const sorted = allKeys.filter((k) => selected.has(k));
    if (sorted.length <= 2) return formatQuarterSelectionLabel(sorted);
    const label = formatQuarterSelectionLabel(sorted.slice(0, 2));
    return `${label} +${sorted.length - 2}`;
  })();

  return (
    <div className="flex flex-wrap items-center gap-2" ref={containerRef}>
      {showBucketToggle && (
        <div
          className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-xs shadow-sm"
          role="group"
          aria-label="Quarter bucket"
        >
          <button
            type="button"
            onClick={() => setBucket('retrospective')}
            className={`rounded px-2.5 py-1 font-medium ${activeBucket === 'retrospective' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            title="Last 8 completed quarters"
          >
            Retrospective
          </button>
          <button
            type="button"
            onClick={() => setBucket('prospective')}
            className={`rounded px-2.5 py-1 font-medium ${activeBucket === 'prospective' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            title="Current quarter + next 7"
          >
            Prospective
          </button>
        </div>
      )}
      <label className="text-sm font-medium text-gray-700">
        Fiscal Quarter{bucketHint ? ` (${bucketHint})` : ''}:
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-gray-900">{triggerLabel}</span>
          {!allActive && selected.size > 0 && selected.size < allKeys.length && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              {selected.size}
            </span>
          )}
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <button
                type="button"
                onClick={selectToday}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                {quarterBucket === 'retrospective' ? 'Latest closed' : "Today's quarter"}
              </button>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                All {allKeys.length}
              </button>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
              {options.map((opt) => {
                const checked = allActive || selected.has(opt.key);
                const empty =
                  availableQuarterKeys.length > 0 && !availableSet.has(opt.key);
                return (
                  <li key={opt.key}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 ${empty ? 'text-gray-400' : 'text-gray-900'}`}
                      title={empty ? 'No data in this quarter' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(opt.key)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1">{opt.label}</span>
                      {empty && <span className="text-[10px] uppercase text-gray-400">empty</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

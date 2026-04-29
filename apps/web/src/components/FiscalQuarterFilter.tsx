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
//   4. Stable option list via `rollingFiscalQuarters()` — the dropdown
//      always renders 4 trailing + current + 4 forward, regardless of
//      whether any data falls in those quarters. This avoids the
//      "options vanish when filtered" anti-pattern.

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  currentFiscalQuarter,
  fiscalQuarterLabel,
  rollingFiscalQuarters,
  type FiscalQuarter,
} from '@/lib/fiscal';

const STORAGE_KEY = 'mdas:fiscalQuarterFilter';

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
   * Whether to auto-redirect to today's quarter when the URL param is
   * empty AND localStorage is empty. Default: true. The Forecast page
   * sets this false because it manages its own single-quarter state.
   */
  autoDefault?: boolean;
}

export function FiscalQuarterFilter({
  availableQuarterKeys = [],
  windowOptions,
  autoDefault = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const param = searchParams.get('quarters') ?? '';
  const selected = useMemo(
    () => new Set(param ? param.split(',').filter(Boolean) : []),
    [param],
  );

  // Stable option list independent of data — see file header note.
  const options = useMemo<FiscalQuarter[]>(
    () => rollingFiscalQuarters(windowOptions?.trailing ?? 4, windowOptions?.forward ?? 4),
    [windowOptions?.trailing, windowOptions?.forward],
  );
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
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored) as string[];
        const valid = arr.filter((k) => allKeys.includes(k));
        if (valid.length > 0) next = valid.join(',');
      }
    } catch {
      // ignore parse errors; fall through to today
    }
    if (!next) {
      const today = currentFiscalQuarter();
      next = today.key;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('quarters', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // We deliberately depend only on `param` and `pathname` so the
    // auto-default fires once per page entry. allKeys is stable per
    // window options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, pathname, autoDefault]);

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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
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

  const selectToday = () => updateSelection(new Set([currentFiscalQuarter().key]));

  const triggerLabel = (() => {
    if (allActive) return 'All Quarters';
    if (selected.size === 0) return 'None';
    if (selected.size === 1) {
      const only = [...selected][0] ?? '';
      return fiscalQuarterLabel(only);
    }
    if (selected.size === allKeys.length) return 'All Quarters';
    const sorted = allKeys.filter((k) => selected.has(k));
    if (sorted.length <= 2) return sorted.map(fiscalQuarterLabel).join(', ');
    return `${sorted.slice(0, 2).map(fiscalQuarterLabel).join(', ')} +${sorted.length - 2}`;
  })();

  return (
    <div className="flex items-center gap-2" ref={containerRef}>
      <label className="text-sm font-medium text-gray-700">Fiscal Quarter:</label>
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
                Today's Quarter
              </button>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                All
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

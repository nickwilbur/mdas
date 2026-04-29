'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fiscalQuarterLabel } from '@/lib/fiscal';

interface QuarterOption {
  key: string;
  label: string;
}

export function AccountFilters({ quarterOptions }: { quarterOptions: QuarterOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const param = searchParams.get('quarters') ?? '';
  const selected = useMemo(
    () => new Set(param ? param.split(',').filter(Boolean) : []),
    [param]
  );
  const allKeys = useMemo(() => quarterOptions.map((o) => o.key), [quarterOptions]);
  const isAll = selected.size === 0 || selected.size === allKeys.length;
  const allActive = selected.size === 0; // empty == all (default)

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

  const updateSelection = (next: Set<string>) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === 0 || next.size === allKeys.length) {
      params.delete('quarters');
    } else {
      params.set('quarters', Array.from(next).sort().join(','));
    }
    router.push(`/accounts?${params.toString()}`, { scroll: false });
  };

  const toggle = (key: string) => {
    // expand "all" (empty) into explicit set when user starts narrowing
    const base = allActive ? new Set(allKeys) : new Set(selected);
    if (base.has(key)) base.delete(key);
    else base.add(key);
    updateSelection(base);
  };

  const selectAll = () => updateSelection(new Set());
  const clearAll = () => updateSelection(new Set(['__none__'])); // sentinel: nothing matches

  const triggerLabel = (() => {
    if (allActive) return 'All Quarters';
    if (selected.size === 0) return 'None';
    if (selected.size === 1) {
      const only = [...selected][0];
      return fiscalQuarterLabel(only);
    }
    if (selected.size === allKeys.length) return 'All Quarters';
    const sortedSel = allKeys.filter((k) => selected.has(k));
    if (sortedSel.length <= 2) return sortedSel.map(fiscalQuarterLabel).join(', ');
    return `${sortedSel.slice(0, 2).map(fiscalQuarterLabel).join(', ')} +${sortedSel.length - 2}`;
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
          <div className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
              {quarterOptions.map((opt) => {
                const checked = allActive || selected.has(opt.key);
                return (
                  <li key={opt.key}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(opt.key)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-gray-900">{opt.label}</span>
                    </label>
                  </li>
                );
              })}
              {quarterOptions.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500">No quarters available</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

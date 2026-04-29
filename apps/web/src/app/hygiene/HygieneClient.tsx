'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface ViolationTypeOption {
  rule: string;
  count: number;
}

export function HygieneFilters({ violationOptions }: { violationOptions: ViolationTypeOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const param = searchParams.get('violationTypes') ?? '';
  const selected = useMemo(
    () => new Set(param ? param.split(',').filter(Boolean) : []),
    [param]
  );
  const allRules = useMemo(() => violationOptions.map((o) => o.rule), [violationOptions]);
  
  // Default to top 3 violation types if nothing selected
  const defaultRules = useMemo(() => {
    if (selected.size > 0) return selected;
    return new Set(violationOptions.slice(0, 3).map((o) => o.rule));
  }, [selected, violationOptions]);
  
  const isAll = selected.size === 0 || selected.size === allRules.length;
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
    if (next.size === 0 || next.size === allRules.length) {
      params.delete('violationTypes');
    } else {
      params.set('violationTypes', Array.from(next).sort().join(','));
    }
    router.push(`/hygiene?${params.toString()}`, { scroll: false });
  };

  const toggle = (rule: string) => {
    const base = allActive ? new Set(allRules) : new Set(selected);
    if (base.has(rule)) base.delete(rule);
    else base.add(rule);
    updateSelection(base);
  };

  const selectAll = () => updateSelection(new Set());
  const clearAll = () => updateSelection(new Set(['__none__'])); // sentinel: nothing matches

  const triggerLabel = (() => {
    if (allActive) return 'All Violation Types';
    if (selected.size === 0) return 'None';
    if (selected.size === 1) {
      const only = [...selected][0] ?? '';
      return only;
    }
    if (selected.size === allRules.length) return 'All Violation Types';
    const sortedSel = allRules.filter((r) => selected.has(r));
    if (sortedSel.length <= 2) return sortedSel.join(', ');
    return `${sortedSel.slice(0, 2).join(', ')} +${sortedSel.length - 2}`;
  })();

  return (
    <div className="flex items-center gap-2" ref={containerRef}>
      <label className="text-sm font-medium text-gray-700">Violation Type:</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-gray-900">{triggerLabel}</span>
          {!allActive && selected.size > 0 && selected.size < allRules.length && (
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
          <div className="absolute left-0 z-20 mt-1 w-80 rounded-md border border-gray-200 bg-white shadow-lg">
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
              {violationOptions.map((opt) => {
                const checked = allActive || selected.has(opt.rule);
                return (
                  <li key={opt.rule}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(opt.rule)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1 text-gray-900">{opt.rule}</span>
                      <span className="text-xs text-gray-500">({opt.count})</span>
                    </label>
                  </li>
                );
              })}
              {violationOptions.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500">No violation types available</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

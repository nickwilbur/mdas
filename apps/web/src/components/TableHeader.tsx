'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';

interface FilterOption {
  value: string;
  label: string;
}

interface TableHeaderProps<TField extends string> {
  /** Display label */
  label: ReactNode;
  /** The sort field key for this column (omit if not sortable) */
  field?: TField;
  /** Currently active sort field */
  sortField?: TField;
  /** Current sort direction */
  sortDirection?: SortDirection;
  /** Sort handler */
  onSort?: (field: TField) => void;
  /** Filter options - omit if not filterable */
  filterOptions?: FilterOption[];
  /** Currently selected filter values */
  selectedFilters?: Set<string>;
  /** Filter change handler */
  onFilterChange?: (selected: Set<string>) => void;
  /** Right align (for numeric columns) */
  align?: 'left' | 'right' | 'center';
  /** Additional class names */
  className?: string;
}

/**
 * Reusable table header cell supporting sorting and filtering.
 * Filter UI appears in a popover triggered by a small filter icon.
 */
export function TableHeader<TField extends string>({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
  filterOptions,
  selectedFilters,
  onFilterChange,
  align = 'left',
  className = '',
}: TableHeaderProps<TField>) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isSortable = field !== undefined && onSort !== undefined;
  const isFilterable = filterOptions !== undefined && onFilterChange !== undefined;
  const isActive = sortField === field;
  const filterActive = (selectedFilters?.size ?? 0) > 0;

  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  const handleSortClick = () => {
    if (isSortable && field) onSort(field);
  };

  const toggleFilter = (value: string) => {
    if (!onFilterChange) return;
    const next = new Set(selectedFilters);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilterChange(next);
  };

  const selectAll = () => onFilterChange?.(new Set(filterOptions?.map((o) => o.value)));
  const clearAll = () => onFilterChange?.(new Set());

  return (
    <th className={`px-3 py-2 ${alignClass} ${className}`}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <span
          className={isSortable ? 'cursor-pointer hover:text-gray-900 select-none' : ''}
          onClick={handleSortClick}
        >
          {label}
          {isSortable && (
            <span className="ml-1 inline-block">
              {!isActive ? (
                <span className="text-gray-300">↕</span>
              ) : sortDirection === 'asc' ? (
                <span className="text-gray-700">↑</span>
              ) : (
                <span className="text-gray-700">↓</span>
              )}
            </span>
          )}
        </span>

        {isFilterable && (
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterOpen((v) => !v);
              }}
              className={`ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 ${
                filterActive ? 'text-blue-600' : 'text-gray-400'
              }`}
              aria-label="Filter"
              title="Filter"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M2 3h12l-4.5 5.5V14L6.5 12V8.5L2 3z" />
              </svg>
            </button>
            {filterOpen && (
              <div
                className="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-gray-200 bg-white p-2 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-1 flex items-center justify-between border-b border-gray-100 pb-1">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {filterOptions!.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm normal-case tracking-normal text-gray-800 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFilters?.has(opt.value) ?? false}
                        onChange={() => toggleFilter(opt.value)}
                        className="rounded"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  );
}

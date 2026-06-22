'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EngagementLastTouch } from '@mdas/renewal-metrics';

function daysSinceTone(days: number | null): string {
  if (days == null) return 'text-gray-400';
  if (days <= 14) return 'text-emerald-700';
  if (days <= 30) return 'text-amber-700';
  return 'text-red-700';
}

function formatTouchDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function EngagementDaysCell({
  days,
  lastTouch,
  label,
}: {
  days: number | null;
  lastTouch: EngagementLastTouch | null;
  /** Accessible name for the metric (e.g. "Slack activity"). */
  label: string;
}): JSX.Element {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updateCoords = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ top: rect.bottom + 8, left: Math.max(8, rect.right - 320) });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const onScroll = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updateCoords]);

  if (days == null) {
    return <span className="text-gray-400">—</span>;
  }

  const hasDetail = lastTouch && (lastTouch.title || lastTouch.summary);
  const tooltipId = `${id}-tooltip`;

  const tooltip =
    open && hasDetail && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-80 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <p className="text-xs font-semibold text-gray-900">{label}</p>
            <p className="mt-1 text-[11px] text-gray-500">
              {days} day{days === 1 ? '' : 's'} ago
              {lastTouch?.occurredAt ? ` · ${formatTouchDate(lastTouch.occurredAt)}` : ''}
            </p>
            {lastTouch?.title ? (
              <p className="mt-2 text-xs font-medium text-gray-800">{lastTouch.title}</p>
            ) : null}
            {lastTouch?.summary ? (
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{lastTouch.summary}</p>
            ) : null}
            {lastTouch?.url ? (
              <p className="mt-2 truncate text-[10px] text-blue-600">{lastTouch.url}</p>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  if (!hasDetail) {
    return (
      <span
        className={`tabular-nums font-medium ${daysSinceTone(days)}`}
        title={`${days} day${days === 1 ? '' : 's'} ago`}
      >
        {days}d
      </span>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`tabular-nums font-medium rounded focus:outline-none focus:ring-2 focus:ring-blue-300 ${daysSinceTone(days)}`}
        aria-label={`${label}: ${days} days ago. Hover for last touch details.`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => {
          updateCoords();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updateCoords();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {days}d
      </button>
      {tooltip}
    </>
  );
}

'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RenewalRiskSignalSummary } from '@mdas/renewal-metrics';
import { AssessmentPill } from '@/components/ui';

const SOURCE_TONE: Record<string, string> = {
  cerebro: 'bg-orange-50 text-orange-800 border-orange-200',
  salesforce: 'bg-blue-50 text-blue-800 border-blue-200',
  gainsight: 'bg-violet-50 text-violet-800 border-violet-200',
  'glean-mcp': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  derived: 'bg-gray-50 text-gray-700 border-gray-200',
};

export function OverallAssessmentCell({
  category,
  detail,
  riskScore,
  riskBand,
  riskConfidence,
  signals,
}: {
  category: string | null;
  detail: string | null;
  riskScore: number | null;
  riskBand: string | null;
  riskConfidence: 'high' | 'low' | null;
  signals: RenewalRiskSignalSummary[];
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

  const label = category ?? riskBand ?? null;

  if (!label) {
    return <span className="text-gray-400">—</span>;
  }

  const sourceLabel =
    category != null
      ? 'Cerebro'
      : riskConfidence === 'low'
        ? 'Composite fallback'
        : 'Derived';

  const tooltipId = `${id}-tooltip`;
  const tooltip =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-80 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <p className="text-xs font-semibold text-gray-900">Overall Assessment</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">
              Source: {sourceLabel}
            </p>
            {detail ? (
              <p className="mt-2 text-xs leading-relaxed text-gray-700">{detail}</p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                {signals.length > 0
                  ? 'Cerebro narrative not synced — signals below reflect the overall assessment index.'
                  : 'No Cerebro overall assessment on file. Refresh data to pull account details.'}
              </p>
            )}
            {riskScore != null && riskBand ? (
              <p className="mt-2 text-xs text-gray-600">
                Assessment index: <strong>{riskScore}</strong> ({riskBand})
                {riskConfidence === 'low' ? (
                  <span className="text-amber-700"> — composite fallback</span>
                ) : null}
              </p>
            ) : null}
            {signals.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2">
                {signals.slice(0, 8).map((s, i) => (
                  <li key={`${s.label}-${i}`} className="flex items-start gap-2 text-xs">
                    <span
                      className={`shrink-0 rounded border px-1 py-0.5 text-[9px] uppercase ${SOURCE_TONE[s.source] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}
                    >
                      {s.source}
                    </span>
                    <span className="flex-1 text-gray-700">{s.label}</span>
                    <span className="tabular-nums font-medium text-gray-900">
                      {s.points > 0 ? `+${s.points}` : s.points}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
        aria-label={`Overall assessment: ${label}. Hover for details.`}
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
        <AssessmentPill category={label} />
        {riskScore != null ? (
          <span className="text-[10px] tabular-nums text-gray-500">({riskScore})</span>
        ) : null}
      </button>
      {tooltip}
    </>
  );
}

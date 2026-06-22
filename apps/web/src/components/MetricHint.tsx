'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Accessible info icon with definition on hover/focus (portaled to avoid overflow clipping). */
export function MetricHint({
  text,
  id: idProp,
  placement = 'top',
}: {
  text: string;
  id?: string;
  /** Preferred tooltip direction; auto-flips when near viewport edge. */
  placement?: 'top' | 'bottom';
}): JSX.Element {
  const autoId = useId();
  const id = idProp ?? autoId;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; flip: boolean }>({
    top: 0,
    left: 0,
    flip: false,
  });

  const updateCoords = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const flip = placement === 'top' && rect.top < 120;
    const top = flip ? rect.bottom + 8 : rect.top - 8;
    setCoords({ top, left: rect.left + rect.width / 2, flip });
  }, [placement]);

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

  const tooltip =
    open && typeof document !== 'undefined'
      ? createPortal(
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-64 -translate-x-1/2 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-gray-700 shadow-lg"
            style={{
              top: coords.top,
              left: coords.left,
              transform: `translate(-50%, ${coords.flip ? '0' : '-100%'})`,
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span className="inline-flex align-middle">
        <button
          ref={btnRef}
          type="button"
          aria-label="Metric definition"
          aria-describedby={open ? id : undefined}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
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
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 bg-gray-50 text-[10px] font-semibold leading-none text-gray-500 hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          ?
        </button>
      </span>
      {tooltip}
    </>
  );
}

export function LabelWithHint({
  label,
  hint,
}: {
  label: ReactNode;
  hint: string;
}): JSX.Element {
  return (
    <span className="inline-flex items-center">
      {label}
      <MetricHint text={hint} />
    </span>
  );
}

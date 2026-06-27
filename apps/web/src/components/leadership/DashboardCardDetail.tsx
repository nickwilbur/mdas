'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DashboardCardContext } from '@/lib/leadership/card-context';

const TOOLTIP_MAX_WIDTH = 360;
const VIEWPORT_GUTTER = 12;

function useFloatingCoords(triggerRef: React.RefObject<HTMLElement | null>, open: boolean) {
  const [coords, setCoords] = useState({ top: 0, left: 0, width: TOOLTIP_MAX_WIDTH });

  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(TOOLTIP_MAX_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    let left = rect.left;
    left = Math.max(VIEWPORT_GUTTER, Math.min(left, window.innerWidth - width - VIEWPORT_GUTTER));
    const top = rect.bottom + 6;
    setCoords({ top, left, width });
  }, [triggerRef]);

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const onMove = () => updateCoords();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, updateCoords]);

  return coords;
}

function CardContextTooltip({
  open,
  triggerRef,
  id,
  context,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  id: string;
  context: DashboardCardContext;
}) {
  const coords = useFloatingCoords(triggerRef, open);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="fixed z-[100] max-w-md rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg"
      style={{
        top: coords.top,
        left: coords.left,
        width: Math.min(448, coords.width),
      }}
    >
      <p className="text-xs font-semibold text-gray-900">{context.title}</p>
      <p className="mt-1 text-xs leading-snug text-gray-600">{context.overview}</p>
      <div className="mt-2 space-y-2 border-t border-gray-100 pt-2 text-xs text-gray-600">
        <div>
          <p className="font-medium text-gray-800">Signal</p>
          <p className="mt-0.5 leading-snug">{context.whatTheSignalMeans}</p>
        </div>
        <div>
          <p className="font-medium text-gray-800">Interpretation</p>
          <p className="mt-0.5 leading-snug">{context.whatTheInterpretationMeans}</p>
        </div>
        {context.measurementNote ? (
          <p className="rounded border border-amber-200 bg-amber-50/80 p-2 text-[11px] leading-snug text-amber-950">
            {context.measurementNote}
          </p>
        ) : null}
        {context.managerActions.length > 0 ? (
          <div>
            <p className="font-medium text-gray-800">Manager actions</p>
            <ul className="mt-0.5 list-inside list-disc space-y-0.5">
              {context.managerActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[10px] text-gray-400">{context.dataSource}</p>
        {context.relatedLinks && context.relatedLinks.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {context.relatedLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[10px] font-medium text-slate-700 underline hover:text-slate-900"
              >
                {l.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function TitleWithHoverContext({
  title,
  context,
  className,
}: {
  title: string;
  context?: DashboardCardContext | null;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);

  if (!context) {
    return <h4 className={className}>{title}</h4>;
  }

  return (
    <>
      <h4
        ref={ref}
        className={clsx(
          'cursor-help border-b border-dotted border-transparent hover:border-slate-400/70',
          className,
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
      >
        {title}
      </h4>
      <CardContextTooltip open={open} triggerRef={ref} id={id} context={context} />
    </>
  );
}

export function HealthAreaDrillCard({
  area,
  statusBadge,
  signal,
  interpretation,
  context,
  cardClassName,
}: {
  area: string;
  statusBadge: React.ReactNode;
  signal: string;
  interpretation: string;
  context: DashboardCardContext;
  cardClassName?: string;
}) {
  return (
    <div className={clsx('flex flex-col rounded-lg border p-3 shadow-sm', cardClassName)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <TitleWithHoverContext
          title={area}
          context={context}
          className="text-sm font-semibold leading-tight text-gray-900"
        />
        {statusBadge}
      </div>
      <p className="mb-1 text-xs text-gray-600">{signal}</p>
      <p className="text-xs leading-snug text-gray-700">{interpretation}</p>
    </div>
  );
}

export function ContextSummaryCard({
  title,
  body,
  overview,
  className,
  titleClassName,
}: {
  title: string;
  body: string;
  overview?: string;
  className?: string;
  titleClassName?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      {title ? (
        overview ? (
          <>
            <p
              ref={ref}
              className={clsx(
                'cursor-help border-b border-dotted border-transparent hover:border-slate-400/70',
                titleClassName,
              )}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              tabIndex={0}
              aria-describedby={open ? id : undefined}
            >
              {title}
            </p>
            {open && typeof document !== 'undefined'
              ? createPortal(
                  <div
                    id={id}
                    role="tooltip"
                    className="pointer-events-none fixed z-[100] max-w-xs rounded-lg border border-gray-200 bg-white p-3 text-xs leading-snug text-gray-600 shadow-lg"
                    style={{
                      top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 6,
                      left: ref.current?.getBoundingClientRect().left ?? 0,
                    }}
                  >
                    {overview}
                  </div>,
                  document.body,
                )
              : null}
          </>
        ) : (
          <p className={titleClassName}>{title}</p>
        )
      ) : null}
      <p className={clsx(title ? 'mt-1' : '', 'text-sm leading-snug text-gray-800')}>{body}</p>
    </div>
  );
}

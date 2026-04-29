'use client';

// Cmd-K command bar — a global Glean search overlay reachable from any
// page. Mounted once in the root layout. Talks to the same
// /api/glean/search endpoint as the /glean page; the only difference
// is the compact UI.
//
// Hotkey: ⌘K (mac) / Ctrl+K (linux/windows). Esc closes. Click on the
// backdrop also closes. We listen at the document level so input
// focus elsewhere doesn't swallow the binding.
import { useEffect, useState, useCallback } from 'react';
import { GleanSearchPanel } from './GleanSearchPanel';

export interface GleanCommandBarProps {
  /** Disable the global hotkey and render nothing — used when the
   *  status badge says Glean isn't reachable so we don't open an empty
   *  overlay on ⌘K. */
  enabled: boolean;
}

export function GleanCommandBar({ enabled }: GleanCommandBarProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [seedQuery, setSeedQuery] = useState('');

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      // ⌘K / Ctrl+K: toggle.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        // Allow callers to seed the query via window event.
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => document.removeEventListener('keydown', onKey);
  }, [enabled, open, close]);

  // Cross-component "open with this query" channel — used by the
  // account drill-in's "Search Glean for {accountName}" button.
  useEffect(() => {
    if (!enabled) return;
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ query?: string }>).detail;
      setSeedQuery(detail?.query ?? '');
      setOpen(true);
    };
    window.addEventListener('mdas:glean:open', onOpen);
    return (): void => window.removeEventListener('mdas:glean:open', onOpen);
  }, [enabled]);

  if (!enabled || !open) return null;

  return (
    <div
      role="dialog"
      aria-label="Glean search"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-24"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>
            Glean search — <kbd className="rounded border border-gray-300 px-1">Esc</kbd> to close
          </span>
          <span>
            <kbd className="rounded border border-gray-300 px-1">⌘K</kbd> toggles
          </span>
        </div>
        <GleanSearchPanel
          initialQuery={seedQuery}
          compact
          autoFocus
          onSelectResult={() => close()}
        />
      </div>
    </div>
  );
}

/**
 * Helper used by other components (e.g. the account drill-in) to open
 * the command bar pre-filled with a query.
 */
export function openGleanCommandBar(query: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mdas:glean:open', { detail: { query } }));
}

'use client';

// Global keyboard hotkey hook for power-user navigation.
//
// Audit ref: F-11 in docs/audit/01_findings.md.
//
// Default bindings (overridable via the `bindings` prop):
//   /         focus the first input matching `data-hotkey-search`
//   j         move focus to the next row marked `data-hotkey-row`
//   k         move focus to the previous row marked `data-hotkey-row`
//   ?         toggle the help overlay (caller renders it; we toggle a flag)
//   Escape    blur active input, close help overlay
//
// Disabled while focus is inside an editable element (input/textarea/
// contenteditable) so typing "j" into a search box doesn't move row
// focus. ? is allowed even inside inputs to keep help discoverable.
import { useEffect, useState } from 'react';

export interface HotkeyBindings {
  search?: string;
  next?: string;
  prev?: string;
  help?: string;
}

const DEFAULTS: Required<HotkeyBindings> = {
  search: '/',
  next: 'j',
  prev: 'k',
  help: '?',
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function focusSearch(): void {
  const el = document.querySelector<HTMLElement>('[data-hotkey-search]');
  el?.focus();
  if (el instanceof HTMLInputElement) {
    el.select();
  }
}

function moveRowFocus(direction: 1 | -1): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-hotkey-row]'));
  if (rows.length === 0) return;
  const active = document.activeElement;
  let idx = -1;
  if (active instanceof HTMLElement) {
    idx = rows.findIndex((r) => r === active || r.contains(active));
  }
  let next = idx + direction;
  if (next < 0) next = 0;
  if (next >= rows.length) next = rows.length - 1;
  const target = rows[next];
  target?.focus();
  target?.scrollIntoView({ block: 'nearest' });
}

export interface UseGlobalHotkeysResult {
  helpOpen: boolean;
  closeHelp: () => void;
}

export function useGlobalHotkeys(
  bindings: HotkeyBindings = {},
): UseGlobalHotkeysResult {
  const keys = { ...DEFAULTS, ...bindings };
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
          e.preventDefault();
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      const editing = isEditable(e.target);
      if (e.key === keys.help) {
        setHelpOpen((v) => !v);
        e.preventDefault();
        return;
      }
      if (editing) return;

      if (e.key === keys.search) {
        focusSearch();
        e.preventDefault();
        return;
      }
      if (e.key === keys.next) {
        moveRowFocus(1);
        e.preventDefault();
        return;
      }
      if (e.key === keys.prev) {
        moveRowFocus(-1);
        e.preventDefault();
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => document.removeEventListener('keydown', onKey);
  }, [helpOpen, keys.search, keys.next, keys.prev, keys.help]);

  return {
    helpOpen,
    closeHelp: (): void => setHelpOpen(false),
  };
}

const SHORTCUT_ROWS: { label: string; key: string }[] = [
  { label: 'Focus search', key: '/' },
  { label: 'Next row', key: 'j' },
  { label: 'Previous row', key: 'k' },
  { label: 'Toggle this help', key: '?' },
  { label: 'Blur / close help', key: 'Esc' },
];

/**
 * Help overlay component — renders nothing when `open` is false.
 */
export function HotkeysHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-900"
            aria-label="Close shortcuts help"
          >
            Close
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          {SHORTCUT_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between">
              <dt className="text-gray-700">{row.label}</dt>
              <dd>
                <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs">
                  {row.key}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

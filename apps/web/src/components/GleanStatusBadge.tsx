'use client';

// Small "Connected to Glean" badge in the top nav. Polls
// /api/glean/health on mount + every 60s. Two roles:
//   1. Lets the user see at a glance whether Glean is reachable.
//   2. Renders the GleanCommandBar (cmd-K) so the bar is only mounted
//      — and the hotkey only registered — when Glean is actually
//      configured. Avoids surprising users with an empty overlay.
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { GleanCommandBar } from './GleanCommandBar';

interface Health {
  ok: boolean;
  details: string;
  principal?: { kind: string; label: string };
  mode?: string;
  code?: string;
}

export function GleanStatusBadge(): JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/glean/health', { cache: 'no-store' });
        const data = (await r.json()) as Health;
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) {
          setHealth({ ok: false, details: 'Glean health check failed' });
        }
      }
    }
    void poll();
    const id = setInterval(poll, 60_000);
    return (): void => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const ok = health?.ok ?? false;

  return (
    <>
      <span
        className={
          ok
            ? 'inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700'
            : 'inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600'
        }
        title={
          health
            ? `${health.details}${health.principal ? ` (${health.principal.label})` : ''}`
            : 'Checking Glean…'
        }
      >
        {ok ? (
          <CheckCircle2 className="h-3 w-3" aria-hidden />
        ) : (
          <AlertCircle className="h-3 w-3" aria-hidden />
        )}
        Glean {ok ? 'connected' : health ? 'offline' : '…'}
        {ok && (
          <kbd className="ml-1 rounded border border-emerald-200 bg-white px-1 text-[10px] text-emerald-800">
            ⌘K
          </kbd>
        )}
      </span>
      <GleanCommandBar enabled={ok} />
    </>
  );
}

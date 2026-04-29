'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Audit ref: F-08 in docs/audit/01_findings.md.
//
// Updated 2026-04-28 (PR-A4): poll the widened /api/refresh/[jobId]
// endpoint and surface 'partial' as a distinct visible state. Prior
// behavior collapsed 'success' and 'partial' into "Refresh success",
// hiding silent adapter failures from the manager.
interface RefreshJobStatus {
  id: string;
  status: string;
  runStatus: 'running' | 'success' | 'partial' | 'failed' | null;
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  errorLog: { source: string; error: string }[] | null;
}

function describeOutcome(s: RefreshJobStatus): { label: string; tone: 'ok' | 'warn' | 'err' } {
  // Prefer the orchestrator's run-level status when present — it carries
  // the partial/full distinction the queue-row status discards.
  const effective = s.runStatus ?? s.status;
  if (effective === 'success') {
    return { label: 'Refresh success', tone: 'ok' };
  }
  if (effective === 'partial') {
    const failed = s.sourcesAttempted.filter((src) => !s.sourcesSucceeded.includes(src));
    const detail = failed.length ? failed.join(', ') : 'some sources';
    return { label: `Refresh partial — ${detail} failed`, tone: 'warn' };
  }
  if (effective === 'failed') {
    return { label: 'Refresh failed', tone: 'err' };
  }
  return { label: `Refresh ${effective}`, tone: 'warn' };
}

export function RefreshButton(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ label: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function refresh(): Promise<void> {
    setBusy(true);
    setMsg({ label: 'Refreshing…', tone: 'warn' });
    try {
      const r = await fetch('/api/refresh', { method: 'POST' });
      if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
      const j = (await r.json()) as { jobId: string };
      // Poll for the new run to land.
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const s = await fetch(`/api/refresh/${j.jobId}`);
        if (s.ok) {
          const sj = (await s.json()) as RefreshJobStatus;
          if (
            sj.status === 'success' ||
            sj.status === 'failed' ||
            // The queue-row status above is bookkeeping only; whenever a
            // run row exists with a terminal run_status we're done.
            sj.runStatus === 'success' ||
            sj.runStatus === 'partial' ||
            sj.runStatus === 'failed'
          ) {
            setMsg(describeOutcome(sj));
            startTransition(() => router.refresh());
            break;
          }
        }
      }
    } catch (err) {
      setMsg({ label: (err as Error).message, tone: 'err' });
    } finally {
      setBusy(false);
      // Partial-success messages persist longer so the user can read the
      // failed-source list before it fades.
      setTimeout(() => setMsg(null), 8000);
    }
  }

  const toneClass =
    msg?.tone === 'err'
      ? 'text-red-700'
      : msg?.tone === 'warn'
        ? 'text-amber-700'
        : 'text-gray-600';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh Data'}
      </button>
      {msg ? (
        <span
          className={`text-xs ${toneClass}`}
          // role=status announces softly (not "alert"-loud) when the text
          // changes — appropriate for a non-modal status message.
          role="status"
          aria-live="polite"
        >
          {msg.label}
        </span>
      ) : null}
    </div>
  );
}

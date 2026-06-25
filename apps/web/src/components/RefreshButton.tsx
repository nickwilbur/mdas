'use client';
import { useState, useTransition, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  subscribeRefreshJobPoll,
  type RefreshProgress,
  type RefreshJobStatus,
} from '@/lib/refresh-job-watch';

// ---------- Helpers ----------

// Friendly display names for adapter sources
const ADAPTER_LABELS: Record<string, string> = {
  'local-snapshots': 'Snapshot baseline',
  'cerebro-rest': 'Cerebro (REST)',
  'cerebro-glean': 'Cerebro (Glean fallback)',
  gainsight: 'Gainsight (CTAs)',
  'glean-mcp': 'Glean (meetings/plans)',
  'zuora-mcp': 'Zuora (billing)',
  salesforce: 'Salesforce',
};

function adapterLabel(name: string): string {
  return ADAPTER_LABELS[name] ?? name;
}

function statusIcon(s: 'pending' | 'running' | 'done' | 'error'): string {
  switch (s) {
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'running':
      return '⟳';
    default:
      return '·';
  }
}

function statusColor(s: 'pending' | 'running' | 'done' | 'error'): string {
  switch (s) {
    case 'done':
      return 'text-emerald-600';
    case 'error':
      return 'text-red-600';
    case 'running':
      return 'text-blue-600';
    default:
      return 'text-gray-400';
  }
}

function describeOutcome(s: RefreshJobStatus): { label: string; tone: 'ok' | 'warn' | 'err' } {
  const effective = s.runStatus ?? s.status;
  if (effective === 'success') return { label: 'Refresh complete — all sources succeeded', tone: 'ok' };
  if (effective === 'partial') {
    const failed = s.sourcesAttempted.filter((src) => !s.sourcesSucceeded.includes(src));
    const detail = failed.length ? failed.map(adapterLabel).join(', ') : 'some sources';
    return { label: `Refresh partial — ${detail} failed`, tone: 'warn' };
  }
  if (effective === 'failed') return { label: 'Refresh failed', tone: 'err' };
  return { label: `Refresh ${effective}`, tone: 'warn' };
}

// ---------- Sub-components ----------

function AdapterRow({
  name,
  ap,
}: {
  name: string;
  ap: { status: 'pending' | 'running' | 'done' | 'error'; current: number; total: number };
}): JSX.Element {
  const pct = ap.total > 0 ? Math.round((ap.current / ap.total) * 100) : ap.status === 'done' ? 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-3 text-center font-bold ${statusColor(ap.status)}`}>
        {statusIcon(ap.status)}
      </span>
      <span className="w-36 truncate font-medium text-gray-700" title={name}>
        {adapterLabel(name)}
      </span>
      <div className="flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              ap.status === 'error' ? 'bg-red-400' : ap.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="w-16 text-right tabular-nums text-gray-500">
        {ap.total > 0 ? `${ap.current}/${ap.total}` : ap.status === 'done' ? 'done' : '—'}
      </span>
    </div>
  );
}

function ProgressPanel({ progress }: { progress: RefreshProgress }): JSX.Element {
  const adapters = progress.adapters ?? {};
  const entries = Object.entries(adapters);
  if (entries.length === 0) return <></>;

  return (
    <div className="mt-3 w-80 space-y-1.5 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-900">Sync Progress</span>
        <span className="text-xs font-bold tabular-nums text-blue-600">{progress.pct ?? 0}%</span>
      </div>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${progress.pct ?? 0}%` }}
        />
      </div>
      {entries.map(([name, ap]) => (
        <AdapterRow key={name} name={name} ap={ap} />
      ))}
    </div>
  );
}

// ---------- Main component ----------

export function RefreshButton(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ label: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const clearMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearStatusLater = useCallback(() => {
    if (clearMsgTimerRef.current) clearTimeout(clearMsgTimerRef.current);
    clearMsgTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setMsg(null);
      setProgress(null);
    }, 10000);
  }, []);

  const detachFromJob = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const attachToJob = useCallback(
    (jobId: string) => {
      detachFromJob();
      setBusy(true);

      unsubscribeRef.current = subscribeRefreshJobPoll(jobId, {
        onProgress: (prog, pct, queueStatus) => {
          if (!mountedRef.current) return;
          if (prog) setProgress(prog);
          const label =
            queueStatus === 'queued' && pct === 0
              ? 'Queued — waiting for worker process…'
              : `Refreshing… ${pct}%`;
          setMsg({ label, tone: 'warn' });
        },
        onPollError: (failures) => {
          if (!mountedRef.current) return;
          if (failures >= 3) {
            setMsg({
              label: `Refresh in progress — status API slow (${failures} retries)…`,
              tone: 'warn',
            });
          }
        },
        onComplete: (sj) => {
          if (!mountedRef.current) return;
          const effective = sj.runStatus ?? sj.status;
          if (effective === 'failed' && sj.progress?.pct && sj.progress.pct > 0 && sj.progress.pct < 100) {
            setMsg({
              label: 'Lost connection to refresh status — reload the page to resume watching',
              tone: 'err',
            });
            setProgress(sj.progress);
            setBusy(false);
            detachFromJob();
            return;
          }
          setMsg(describeOutcome(sj));
          setProgress(sj.progress);
          startTransition(() => router.refresh());
          setBusy(false);
          detachFromJob();
          clearStatusLater();
        },
      });
    },
    [clearStatusLater, detachFromJob, router, startTransition],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detachFromJob();
      if (clearMsgTimerRef.current) clearTimeout(clearMsgTimerRef.current);
    };
  }, [detachFromJob]);

  // On mount, resume watching an in-flight refresh without re-triggering it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/refresh', {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { jobId: string | null };
        if (!j.jobId) return;
        setMsg({
          label: 'Refresh in progress — reconnected, watching progress…',
          tone: 'warn',
        });
        attachToJob(j.jobId);
      } catch {
        // No active job, or a transient error — nothing to resume.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachToJob]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMsg({ label: 'Starting refresh…', tone: 'warn' });
    setProgress(null);
    try {
      const r = await fetch('/api/refresh', { method: 'POST' });
      if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
      const coalesced = r.headers.get('x-coalesced') === '1';
      const j = (await r.json()) as { jobId: string; coalesced?: boolean };

      if (coalesced || j.coalesced) {
        setMsg({
          label: 'Joined an in-flight refresh — watching progress…',
          tone: 'warn',
        });
      }

      attachToJob(j.jobId);
    } catch (err) {
      setMsg({ label: (err as Error).message, tone: 'err' });
      setBusy(false);
    }
  }, [attachToJob]);

  const toneClass =
    msg?.tone === 'err'
      ? 'text-red-700'
      : msg?.tone === 'warn'
        ? 'text-amber-700'
        : msg?.tone === 'ok'
          ? 'text-emerald-700'
          : 'text-gray-600';

  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        <button
          onClick={handleRefresh}
          disabled={busy}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow transition-opacity disabled:opacity-50"
        >
          {busy ? 'Refreshing…' : 'Refresh Data'}
        </button>
        {msg ? (
          <span className={`text-xs font-medium ${toneClass}`} role="status" aria-live="polite">
            {msg.label}
          </span>
        ) : null}
      </div>
      {busy && progress ? <ProgressPanel progress={progress} /> : null}
    </div>
  );
}

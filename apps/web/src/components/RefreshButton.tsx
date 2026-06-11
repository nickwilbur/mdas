'use client';
import { useState, useTransition, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ---------- Types ----------

interface AdapterProgress {
  status: 'pending' | 'running' | 'done' | 'error';
  current: number;
  total: number;
  label?: string;
}

interface RefreshProgress {
  adapters?: Record<string, AdapterProgress>;
  pct?: number;
}

interface RefreshJobStatus {
  id: string;
  status: string;
  runStatus: 'running' | 'success' | 'partial' | 'failed' | null;
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  errorLog: { source: string; error: string }[] | null;
  progress: RefreshProgress | null;
}

// ---------- Helpers ----------

// Friendly display names for adapter sources
const ADAPTER_LABELS: Record<string, string> = {
  'local-snapshots': 'Snapshot baseline',
  'cerebro-glean': 'Cerebro (risk data)',
  gainsight: 'Gainsight (CTAs)',
  'glean-mcp': 'Glean (meetings/plans)',
  'zuora-mcp': 'Zuora (billing)',
  salesforce: 'Salesforce',
};

function adapterLabel(name: string): string {
  return ADAPTER_LABELS[name] ?? name;
}

function statusIcon(s: AdapterProgress['status']): string {
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

function statusColor(s: AdapterProgress['status']): string {
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

function AdapterRow({ name, ap }: { name: string; ap: AdapterProgress }): JSX.Element {
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
      {/* Overall bar */}
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
  // Tracks the job currently being polled so the mount-time resume and
  // a manual click can't both attach two polling loops to the same job.
  const watchingRef = useRef<string | null>(null);

  // Poll a job to completion, mirroring its server-side progress into
  // the UI. The refresh runs entirely in the worker process — this loop
  // is read-only status display, so closing the tab never affects the
  // refresh itself; reopening just re-attaches a fresh poller.
  const watchJob = useCallback(
    async (jobId: string): Promise<void> => {
      if (watchingRef.current === jobId) return; // already watching it
      watchingRef.current = jobId;
      setBusy(true);
      try {
        // Adaptive polling: 500ms for the first 6s (so the progress bar
        // appears responsive once the worker picks up the job — typical
        // pickup latency is ≤2s via LISTEN/NOTIFY), then back off to 2s
        // for the long tail. A 40-minute ceiling matches the original.
        //
        // Each fetch is wrapped in an AbortSignal so a hung response
        // can't pin a polling iteration forever.
        const POLL_DEADLINE = Date.now() + 40 * 60 * 1000;
        let pollIdx = 0;
        while (Date.now() < POLL_DEADLINE) {
          const interval = pollIdx < 12 ? 500 : 2000;
          pollIdx += 1;
          await new Promise((res) => setTimeout(res, interval));

          let sj: RefreshJobStatus | null = null;
          try {
            const s = await fetch(`/api/refresh/${jobId}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (!s.ok) continue;
            sj = (await s.json()) as RefreshJobStatus;
          } catch {
            // Network blip or aborted poll — retry next tick.
            continue;
          }

          if (sj.progress) setProgress(sj.progress);

          const pct = sj.progress?.pct ?? 0;
          setMsg({ label: `Refreshing… ${pct}%`, tone: 'warn' });

          if (
            sj.runStatus === 'success' ||
            sj.runStatus === 'partial' ||
            sj.runStatus === 'failed' ||
            sj.status === 'failed'
          ) {
            setMsg(describeOutcome(sj));
            setProgress(sj.progress);
            startTransition(() => router.refresh());
            break;
          }
        }
      } catch (err) {
        setMsg({ label: (err as Error).message, tone: 'err' });
      } finally {
        setBusy(false);
        watchingRef.current = null;
        setTimeout(() => {
          setMsg(null);
          setProgress(null);
        }, 10000);
      }
    },
    [router, startTransition],
  );

  // On mount, ask the server whether a refresh is already in flight
  // (e.g., one this browser started before the window was closed, or one
  // kicked off from another tab). If so, resume showing its status
  // without re-triggering — the refresh is server-side and keeps running
  // independent of any open page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/refresh', {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!r.ok) return;
        const j = (await r.json()) as { jobId: string | null };
        if (cancelled || !j.jobId) return;
        setMsg({
          label: 'Refresh in progress — reconnected, watching progress…',
          tone: 'warn',
        });
        void watchJob(j.jobId);
      } catch {
        // No active job, or a transient error — nothing to resume.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchJob]);

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

      await watchJob(j.jobId);
    } catch (err) {
      setMsg({ label: (err as Error).message, tone: 'err' });
      setBusy(false);
    }
  }, [watchJob]);

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

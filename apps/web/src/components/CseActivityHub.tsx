'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatSnapshotProgress,
  subscribeCseSnapshotJobPoll,
  type CseSnapshotJob,
} from '@/lib/cse-activity/snapshot-job-watch';

export function CseActivityActions({
  latestSnapshot,
}: {
  latestSnapshot: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<CseSnapshotJob | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const detachFromJob = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const attachToJob = useCallback(
    (jobId: string, resume = false) => {
      detachFromJob();
      setBusy('snapshot');
      setJob({
        id: jobId,
        status: 'running',
        progress: null,
        result: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });
      setMessage(
        resume ? 'Snapshot in progress — reconnected…' : 'Starting weekly snapshot…',
      );

      unsubscribeRef.current = subscribeCseSnapshotJobPoll(jobId, {
        onProgress: (sj) => {
          if (!mountedRef.current) return;
          setJob(sj);
          setMessage(formatSnapshotProgress(sj));
        },
        onPollError: (failures) => {
          if (!mountedRef.current || failures < 3) return;
          setMessage(`Snapshot running — status API slow (${failures} retries)…`);
        },
        onComplete: (sj) => {
          if (!mountedRef.current) return;
          setJob(sj);
          detachFromJob();
          setBusy(null);
          if (sj.status === 'done' && sj.result) {
            setMessage(
              `Snapshot saved for ${sj.result.snapshotDate} (${sj.result.teamReportCount} team reports).`,
            );
            router.refresh();
            router.push(`/admin/cse-activity/snapshots/${sj.result.snapshotDate}`);
            return;
          }
          setMessage(sj.error ?? 'Snapshot generation failed');
        },
      });
    },
    [detachFromJob, router],
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetch('/api/cse-activity/snapshot', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { jobId?: string | null; status?: string | null } | null) => {
        if (!mountedRef.current || !data?.jobId || data.status !== 'running') return;
        attachToJob(data.jobId, true);
      })
      .catch(() => undefined);

    return () => {
      mountedRef.current = false;
      detachFromJob();
    };
  }, [attachToJob, detachFromJob]);

  async function startSnapshot() {
    setBusy('snapshot');
    setMessage(null);
    try {
      const res = await fetch('/api/cse-activity/snapshot', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        jobId?: string;
        code?: string;
      };
      if (res.status === 429 && data.jobId) {
        attachToJob(data.jobId, true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (!data.jobId) throw new Error('No job id returned');
      attachToJob(data.jobId);
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(null);
    }
  }

  async function post(path: string, label: string) {
    setBusy(label);
    setMessage(null);
    try {
      const res = await fetch(path, { method: 'POST' });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      setMessage(data.message ?? 'Done');
      router.refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const progressPct =
    job?.progress && job.progress.total > 0
      ? Math.min(100, Math.round((job.progress.current / job.progress.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void startSnapshot()}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {busy === 'snapshot' ? 'Generating…' : 'Generate weekly snapshot'}
        </button>
        {latestSnapshot && (
          <>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                post(
                  `/api/cse-activity/snapshots/${latestSnapshot}/regenerate-dashboard`,
                  'dashboard',
                )
              }
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Regenerate manager dashboard
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                post(
                  `/api/cse-activity/snapshots/${latestSnapshot}/team-reports`,
                  'reports',
                )
              }
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Regenerate team reports
            </button>
          </>
        )}
      </div>
      {busy === 'snapshot' && (
        <div className="max-w-md space-y-1 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <div className="flex items-center justify-between gap-2">
            <span>{message ?? 'Working…'}</span>
            {progressPct != null && (
              <span className="tabular-nums text-xs">{progressPct}%</span>
            )}
          </div>
          {progressPct != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-blue-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
          <p className="text-xs text-blue-800/80">
            Calendar and Slack come from MDAS Refresh (glean-mcp adapter), not a separate live fetch.
          </p>
        </div>
      )}
      {message && busy !== 'snapshot' && (
        <span className="text-sm text-gray-600">{message}</span>
      )}
    </div>
  );
}

export function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 print:hidden"
    >
      Export PDF (print)
    </button>
  );
}

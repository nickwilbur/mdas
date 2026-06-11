import { NextResponse } from 'next/server';
import { audit, enqueueRefreshJob, query } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Staleness guard shared by POST (coalescing) and GET (resume): a
// `running` row whose `started_at` is older than the longest plausible
// refresh is treated as a zombie (worker crashed between claimNextJob()
// and completeJob()) and ignored. Historical max refresh is ~14min
// (837s); 1h cutoff is comfortably above that. The worker also sweeps
// these on startup (apps/worker/src/main.ts reapStaleJobs).
const STALE_RUNNING_CUTOFF = "NOW() - INTERVAL '1 hour'";

/**
 * The single in-flight refresh job (queued, or running and not stale),
 * or null when nothing is active. Used by POST to coalesce duplicate
 * clicks and by GET so a browser that reconnects mid-refresh can
 * resume watching the same job without re-triggering it.
 */
async function findActiveRefreshJob(): Promise<{ id: string; status: string } | null> {
  const pending = await query<{ id: string; status: string }>(
    `SELECT id, status FROM refresh_jobs
       WHERE status = 'queued'
          OR (status = 'running' AND started_at IS NOT NULL AND started_at > ${STALE_RUNNING_CUTOFF})
       ORDER BY enqueued_at DESC
       LIMIT 1`,
  );
  return pending.rows[0] ?? null;
}

// GET /api/refresh — report the currently active refresh job (if any)
// without enqueuing one. The refresh itself is server-side (the worker
// runs it regardless of any open browser); this lets the client page
// rediscover an in-flight job on load and resume showing its status
// even if the window that started it was closed.
export async function GET(): Promise<Response> {
  const active = await findActiveRefreshJob();
  return NextResponse.json(
    active ? { jobId: active.id, status: active.status } : { jobId: null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// PR-B4 (F-14): the jobId is the natural request-id for the refresh
// pipeline — it's persisted on `refresh_jobs.id`, returned to the
// caller, and threaded into every worker log line via runRefresh's
// `requestId` option. We also echo it back in an `X-Request-Id`
// response header so a manager / curl user can correlate without
// reading the JSON body.
//
// Coalescing: if there's already a queued or running job, return its
// id instead of enqueueing a duplicate. A refresh takes 15–25 minutes
// in production; a manager clicking "Refresh" twice (or two browser
// tabs open) previously piled up duplicate jobs that each spent their
// per-source Glean rate-limit budget on the same data. The X-Coalesced
// response header tells the client whether they got a new job or
// joined an in-flight one — useful for the UI's status copy.
export async function POST(req: Request): Promise<Response> {
  const inbound = req.headers.get('x-request-id') ?? null;

  // Look for an already-pending job (queued or running) and reuse it so
  // concurrent POSTs from different tabs converge on the same job —
  // `claimNextJob()` in the worker serializes via `FOR UPDATE SKIP
  // LOCKED` so we never end up with two workers running the same job.
  // Stale `running` zombies are ignored (see findActiveRefreshJob)
  // otherwise every subsequent click latches onto a crashed job and the
  // UI sits at 0% until its 40-minute poll deadline.
  const existing = await findActiveRefreshJob();
  if (existing) {
    await audit('manual:nick', 'refresh.coalesced', {
      jobId: existing.id,
      existingStatus: existing.status,
      ...(inbound ? { upstreamRequestId: inbound } : {}),
    });
    return NextResponse.json(
      { jobId: existing.id, coalesced: true, existingStatus: existing.status },
      {
        headers: {
          'X-Request-Id': inbound ?? existing.id,
          'X-Coalesced': '1',
        },
      },
    );
  }

  const jobId = await enqueueRefreshJob('manual:nick');
  await audit('manual:nick', 'refresh.requested', {
    jobId,
    ...(inbound ? { upstreamRequestId: inbound } : {}),
  });
  return NextResponse.json(
    { jobId },
    { headers: { 'X-Request-Id': inbound ?? jobId } },
  );
}

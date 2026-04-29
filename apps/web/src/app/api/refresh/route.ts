import { NextResponse } from 'next/server';
import { audit, enqueueRefreshJob } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PR-B4 (F-14): the jobId is the natural request-id for the refresh
// pipeline — it's persisted on `refresh_jobs.id`, returned to the
// caller, and threaded into every worker log line via runRefresh's
// `requestId` option. We also echo it back in an `X-Request-Id`
// response header so a manager / curl user can correlate without
// reading the JSON body.
export async function POST(req: Request): Promise<Response> {
  // Honor an inbound X-Request-Id header if the caller provided one
  // (e.g. a future API gateway), but fall back to the freshly-minted
  // jobId so we always have a stable trace key.
  const inbound = req.headers.get('x-request-id') ?? null;
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

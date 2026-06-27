import { NextResponse } from 'next/server';
import {
  findActiveCseSnapshotJob,
  getCseSnapshotJob,
  listCseSnapshotJobsRecent,
  startCseSnapshotJob,
} from '@/lib/cse-activity/snapshot-runner';
import { CSE_SNAPSHOT_JOB_MAX_CONCURRENT } from '@/lib/cse-activity/snapshot-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  try {
    const job = startCseSnapshotJob(req);
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        message: 'Snapshot generation started — poll for progress.',
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    const message = (err as Error).message ?? 'Failed to start snapshot';
    if (message.includes('already running')) {
      const active = findActiveCseSnapshotJob();
      return NextResponse.json(
        {
          error: `At most ${CSE_SNAPSHOT_JOB_MAX_CONCURRENT} snapshot can run at once`,
          code: 'already-running',
          jobId: active?.id ?? null,
        },
        { status: 429, headers: NO_STORE },
      );
    }
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(req: Request): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get('jobId');

  if (jobId) {
    const job = getCseSnapshotJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(job, { headers: NO_STORE });
  }

  const active = findActiveCseSnapshotJob();
  return NextResponse.json(
    {
      jobId: active?.id ?? null,
      status: active?.status ?? null,
      progress: active?.progress ?? null,
      jobs: listCseSnapshotJobsRecent(10),
    },
    { headers: NO_STORE },
  );
}

import { NextResponse } from 'next/server';
import { audit, enqueueRefreshJob } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const jobId = await enqueueRefreshJob('manual:nick');
  await audit('manual:nick', 'refresh.requested', { jobId });
  return NextResponse.json({ jobId });
}

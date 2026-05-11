import { NextResponse } from 'next/server';
import { jobs } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: { jobId: string } },
): Promise<Response> {
  const job = jobs.get(ctx.params.jobId);
  if (!job) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(job);
}

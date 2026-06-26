import { NextResponse } from 'next/server';
import { getCtaJob } from '@/lib/cta-generation-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/ctas/generate/[jobId] — legacy path; prefer ?jobId= on the parent route
// (dynamic segments can hang in Next dev).
export async function GET(
  _req: Request,
  ctx: { params: { jobId: string } },
): Promise<Response> {
  const job = getCtaJob(ctx.params.jobId);
  if (!job) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(job, { headers: { 'Cache-Control': 'no-store' } });
}

import { NextResponse } from 'next/server';
import { getRefreshJobStatus } from '@/lib/refresh-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type { RefreshJobStatus } from '@/lib/refresh-status';

export async function GET(
  _req: Request,
  ctx: { params: { jobId: string } },
): Promise<Response> {
  const body = await getRefreshJobStatus(ctx.params.jobId);
  if (!body) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(body);
}

import { NextResponse } from 'next/server';
import { query } from '@mdas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: { jobId: string } },
): Promise<Response> {
  const r = await query<{ id: string; status: string; refresh_run_id: string | null }>(
    `SELECT id, status, refresh_run_id FROM refresh_jobs WHERE id = $1`,
    [ctx.params.jobId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}

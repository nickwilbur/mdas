import { NextResponse } from 'next/server';
import { listMappings } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
  const status = url.searchParams.get('status') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  const result = await listMappings({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    status: status || undefined,
    q: q || undefined,
  });
  return NextResponse.json(result);
}

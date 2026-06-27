import { NextResponse } from 'next/server';
import { compareCseSnapshots, listCseSnapshots } from '@/lib/cse-activity/service';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const current = url.searchParams.get('current');
  const prior = url.searchParams.get('prior') ?? undefined;
  if (!current) {
    return NextResponse.json({ snapshots: listCseSnapshots() });
  }
  const comparison = compareCseSnapshots(current, prior);
  if (!comparison) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  return NextResponse.json(comparison);
}

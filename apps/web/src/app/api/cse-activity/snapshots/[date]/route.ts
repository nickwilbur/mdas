import { NextResponse } from 'next/server';
import { getCseSnapshot } from '@/lib/cse-activity/service';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { date } = await params;
  const snapshot = getCseSnapshot(date);
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(snapshot.metadata);
}

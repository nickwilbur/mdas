import { NextResponse } from 'next/server';
import { regenerateManagerDashboard } from '@/lib/cse-activity/service';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { date } = await params;
  const md = regenerateManagerDashboard(date);
  if (!md) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  return NextResponse.json({ message: 'Manager dashboard regenerated.', snapshotDate: date });
}

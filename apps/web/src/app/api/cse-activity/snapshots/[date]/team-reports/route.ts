import { NextResponse } from 'next/server';
import { regenerateTeamReports } from '@/lib/cse-activity/service';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { date } = await params;
  const names = await regenerateTeamReports(date);
  if (names.length === 0) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  }
  return NextResponse.json({
    message: `Regenerated ${names.length} team member reports.`,
    snapshotDate: date,
  });
}

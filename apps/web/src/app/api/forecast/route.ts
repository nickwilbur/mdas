import { NextResponse } from 'next/server';
import { generateWeeklyForecast } from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    audience?: string;
  };
  const { views } = await getDashboardData();
  const { events } = await getWoWChangeEvents();
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);
  const md = generateWeeklyForecast({ views, changeEvents: events, asOfDate, audience: body.audience });
  return NextResponse.json({ markdown: md, asOfDate });
}

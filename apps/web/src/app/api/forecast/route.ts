import { NextResponse } from 'next/server';
import {
  generateWeeklyForecast,
  generateClariCsv,
  findDarkAccounts,
} from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PR-C3 (§4.7): the response now ships markdown + Clari-paste CSV
// + dark-account summary in one round trip so the ForecastClient
// can render all three without re-fetching.
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    audience?: string;
  };
  const { views } = await getDashboardData();
  const { events } = await getWoWChangeEvents();
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);
  const markdown = generateWeeklyForecast({
    views,
    changeEvents: events,
    asOfDate,
    audience: body.audience,
  });
  const clariCsv = generateClariCsv(views);
  const darkAccounts = findDarkAccounts(views, { windowDays: 7 });
  return NextResponse.json({
    markdown,
    clariCsv,
    darkAccounts,
    asOfDate,
  });
}

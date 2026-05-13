import { NextResponse } from 'next/server';
import { generateWeeklyForecast } from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate the plaintext quarterly churn-forecast script.
 *
 * Accepts optional `clariManagerForecastCsv` (manager export) so headline
 * Flash / Plan / Hedge match Clari’s latest populated Forecast Value
 * week. Account/opportunity data still drives narrative sections.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
    /** Pasted Clari manager forecast export — headline Flash / Plan / Hedge when present. */
    clariManagerForecastCsv?: string;
  };
  const { views } = await getDashboardData();
  const { events } = await getWoWChangeEvents();
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);
  const text = generateWeeklyForecast({
    views,
    changeEvents: events,
    asOfDate,
    plan: body.plan,
    clariManagerForecastCsv: body.clariManagerForecastCsv,
  });
  return NextResponse.json({ text, asOfDate });
}

import { NextResponse } from 'next/server';
import { generateWeeklyForecast } from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate the plaintext quarterly churn-forecast script.
 *
 * The previous markdown / Clari-CSV / dark-accounts tri-payload was
 * scoped to the weekly forecast UX. The 2026-04-29 redesign reduces
 * the surface to a single plaintext field aligned with the manager's
 * existing churn-call template.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
  };
  const { views } = await getDashboardData();
  const { events } = await getWoWChangeEvents();
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);
  const text = generateWeeklyForecast({
    views,
    changeEvents: events,
    asOfDate,
    plan: body.plan,
  });
  return NextResponse.json({ text, asOfDate });
}

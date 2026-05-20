import { NextResponse } from 'next/server';
import { generateWeeklyForecast } from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import { loadForecastTrajectory } from '@/lib/forecast-trajectory';
import { generateHealthSnapshots } from '@/lib/forecast-narrative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate the plaintext quarterly churn-forecast script.
 *
 * Accepts optional `clariManagerForecastCsv` (manager export) so headline
 * Flash / Plan / Hedge match Clari’s latest populated Forecast Value
 * week. Account/opportunity data still drives narrative sections.
 *
 * Per 2026-05-20 user feedback this route now also generates a
 * qualitative per-quarter Health Snapshot via Glean Adaptive chat.
 * Trajectory series (every refresh snapshot since start of quarter,
 * deduped to last-of-day) → Glean chat → narrative paragraph
 * spliced into the script between the KPI block and the per-account
 * sections. On Glean failure the section renders a stale-marker
 * instead of blocking the whole script.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
    /** Pasted Clari manager forecast export — headline Flash / Plan / Hedge when present. */
    clariManagerForecastCsv?: string;
  };
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);

  // Fan out: current snapshot for the deterministic script, trajectory
  // for the LLM narrative. Both reads hit the same DB so we parallelize
  // to keep the "Generate Update" round-trip snappy.
  const [{ views }, { events }, trajectory] = await Promise.all([
    getDashboardData(),
    getWoWChangeEvents(),
    loadForecastTrajectory(asOfDate, body.plan, body.clariManagerForecastCsv),
  ]);

  // Glean Adaptive narrative. Sequenced after trajectory load
  // because the prompt needs the series; failures inside this call
  // are swallowed and surfaced as a stale-marker per quarter.
  const healthSnapshot = await generateHealthSnapshots(req, trajectory);

  const text = generateWeeklyForecast({
    views,
    changeEvents: events,
    asOfDate,
    plan: body.plan,
    clariManagerForecastCsv: body.clariManagerForecastCsv,
    healthSnapshot,
  });
  return NextResponse.json({ text, asOfDate });
}

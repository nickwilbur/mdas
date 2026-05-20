import { NextResponse } from 'next/server';
import {
  generateWeeklyForecast,
  type ForecastInput,
} from '@mdas/forecast-generator';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import { loadForecastTrajectory } from '@/lib/forecast-trajectory';
import { generateHealthSnapshots } from '@/lib/forecast-narrative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NARRATIVE_FAILURE_MARKER = '[Narrative unavailable — Glean call failed]';

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
 * sections.
 *
 * Failure isolation (2026-05-20):
 *   - Glean / trajectory failures must NEVER block the deterministic
 *     script. The manager can paste the rest of the forecast even
 *     when the LLM call is broken.
 *   - Top-level errors are JSON-formatted instead of bubbling up as
 *     a blank 500 body (which the client surfaces as
 *     "Unexpected end of JSON input").
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
    /** Pasted Clari manager forecast export — headline Flash / Plan / Hedge when present. */
    clariManagerForecastCsv?: string;
  };
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);

  try {
    // Deterministic script reads always run. Glean / trajectory is
    // isolated below — if it fails the script still renders.
    const [{ views }, { events }] = await Promise.all([
      getDashboardData(),
      getWoWChangeEvents(),
    ]);

    // Optional Glean-powered Health Snapshot. Failures here become a
    // stale-marker on both quarters rather than a 500 on the route.
    // The trajectory load + LLM call are bracketed together so the
    // marker covers any failure mode (DB query, prompt build, Glean
    // upstream, empty reply).
    let healthSnapshot: ForecastInput['healthSnapshot'] | undefined;
    try {
      const trajectory = await loadForecastTrajectory(
        asOfDate,
        body.plan,
        body.clariManagerForecastCsv,
      );
      healthSnapshot = await generateHealthSnapshots(req, trajectory);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('forecast.healthSnapshot.failed', {
        asOfDate,
        message: (err as Error)?.message,
      });
      healthSnapshot = {
        currentQuarter: NARRATIVE_FAILURE_MARKER,
        nextQuarter: NARRATIVE_FAILURE_MARKER,
      };
    }

    const text = generateWeeklyForecast({
      views,
      changeEvents: events,
      asOfDate,
      plan: body.plan,
      clariManagerForecastCsv: body.clariManagerForecastCsv,
      healthSnapshot,
    });
    return NextResponse.json({ text, asOfDate });
  } catch (err) {
    // Last-resort: any failure in the deterministic path returns a
    // structured JSON body so the client renders a useful error
    // instead of the unhelpful "Unexpected end of JSON input"
    // SyntaxError that comes from parsing an empty 500 response.
    // eslint-disable-next-line no-console
    console.error('forecast.route.failed', err);
    const message = (err as Error)?.message ?? 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to generate forecast', detail: message },
      { status: 500 },
    );
  }
}

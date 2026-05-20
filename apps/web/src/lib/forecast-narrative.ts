// Server-only Health Snapshot narrative generator.
//
// Wraps the per-quarter trajectory series from forecast-trajectory.ts
// into a Glean Adaptive chat prompt and returns the LLM's reply as a
// plain text string. Failure mode is explicit: on any error
// (credentials missing, Glean upstream 5xx, timeout, malformed reply)
// we return null and let the caller decide whether to render a
// stale-marker, omit the section, or fail loud. The forecast route
// substitutes `'[Narrative unavailable — Glean call failed]'` per
// 2026-05-20 user feedback.
//
// Prompt design (2026-05-20):
//   - Voice: CSE manager → Zuora leadership. Plaintext only.
//   - Audience already has Plan / Flash / Gap / Hedge / WoW / Top
//     accounts on the page above and below; do NOT restate dollar
//     figures verbatim. The narrative's job is judgment, not math.
//   - 3-5 sentences. Answer: (a) how healthy is the quarter today?
//     (b) how is it trending across the quarter so far? (c) any
//     callout that isn't obvious from the numbers above/below.
//   - Use leadership vocabulary: "Gap to Plan", "flashing N% to
//     Plan", "Status quo from last week". Confirmed in Glean prior
//     art (Sam Lawley / Katie Kirkland sections of the NoAM FY27
//     Renewal Script).
//   - When the trajectory has only one point (cold start), say so —
//     don't fabricate a multi-week trend.
import 'server-only';
import { gleanForRequest } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type { ForecastTrajectory, TrajectoryPoint } from './forecast-trajectory';

const FAILURE_MARKER_PREFIX = '[Narrative unavailable — Glean call failed';

function failureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `${FAILURE_MARKER_PREFIX}: ${cleaned}]`
    : `${FAILURE_MARKER_PREFIX}]`;
}

/**
 * Generate per-quarter Health Snapshot narratives from a trajectory
 * series. Returns `{ currentQuarter, nextQuarter }` strings ready to
 * pass to `generateWeeklyForecast({ healthSnapshot })`.
 *
 * On failure of either quarter's LLM call we substitute the failure
 * marker rather than throwing. The caller (forecast route) treats
 * both quarters independently — a Glean outage hitting one prompt
 * shouldn't blank the other.
 */
export async function generateHealthSnapshots(
  req: Request,
  trajectory: ForecastTrajectory,
): Promise<{ currentQuarter: string; nextQuarter: string }> {
  // Both prompts can run in parallel; they're independent chat
  // sessions and Glean rate limits comfortably accommodate it.
  const [current, next] = await Promise.all([
    runOneNarrative(req, 'current', trajectory.currentQuarter, trajectory.asOfDate),
    runOneNarrative(req, 'next', trajectory.nextQuarter, trajectory.asOfDate),
  ]);
  return { currentQuarter: current, nextQuarter: next };
}

async function runOneNarrative(
  req: Request,
  quarter: 'current' | 'next',
  points: TrajectoryPoint[],
  asOfDate: string,
): Promise<string> {
  if (points.length === 0) {
    // Nothing to summarize — no snapshots in the quarter yet (cold
    // start, or asOfDate landed in a quarter we haven't refreshed
    // into). Return empty so the renderer omits the block entirely
    // rather than spending a Glean call to produce filler copy.
    return '';
  }
  try {
    const prompt = buildPrompt(quarter, points, asOfDate);
    const { client } = await gleanForRequest(req);
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = reply.text?.trim();
    if (!text) return failureMarker('empty reply from Glean chat');
    return text;
  } catch (err) {
    // Log structured for ops, but never throw — a Glean outage must
    // not block the manager from pasting the rest of the script
    // into the leadership call.
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.healthSnapshot.glean_failed', {
      quarter,
      asOfDate,
      pointCount: points.length,
      message,
    });
    return failureMarker(message);
  }
}

/**
 * Build the Glean Adaptive chat prompt for one quarter. Keep the
 * structure rigid (USER fragment with sections labeled in caps) so
 * the model treats it as data + instruction, not as a fuzzy ask.
 *
 * Trajectory facts are presented as a compact CSV-ish table; the
 * model has enough context to reason about a trend without us
 * hand-rolling the trend sentence ourselves.
 */
function buildPrompt(
  quarter: 'current' | 'next',
  points: TrajectoryPoint[],
  asOfDate: string,
): string {
  const label = points[0]!.kpis.fiscalQuarterLabel;
  const quarterPhrase = quarter === 'current' ? 'the current quarter' : 'the next quarter';
  const trajectoryTable = points
    .map((p) => {
      const k = p.kpis;
      const flash = signedUsd(k.flashUSD);
      const plan = k.planUSD != null ? signedUsd(k.planUSD) : 'unknown';
      const gap = k.gapUSD != null ? signedUsd(k.gapUSD) : 'unknown';
      const hedge = usd(k.hedgeUSD);
      const total = signedUsd(k.totalRiskUSD);
      return `${p.date} | Plan ${plan} | Flash ${flash} | Gap ${gap} | TotalRisk ${total} | Hedge ${hedge} | Red ${k.redAccountCount} | Yellow ${k.yellowAccountCount} | Accounts ${k.accountCount}`;
    })
    .join('\n');

  const firstDay = points[0]!.date;
  const lastDay = points[points.length - 1]!.date;
  const seriesSpan =
    points.length === 1
      ? `one snapshot (cold start: ${firstDay})`
      : `${points.length} snapshots from ${firstDay} through ${lastDay}`;

  return [
    `You are a Zuora Customer Success Executive (CSE) manager for the Expand 3 franchise, writing the qualitative "Health Snapshot" paragraph that sits inside a weekly churn/downsell forecast script the leadership team reads on a Wednesday call.`,
    ``,
    `WRITE: a 3-5 sentence paragraph (no bullets, no markdown, plaintext only) that answers:`,
    `  1. How healthy is ${quarterPhrase} (${label}) as of today (${asOfDate})?`,
    `  2. How is it trending across the snapshots so far this quarter?`,
    `  3. One subjective callout that is NOT obvious from the dollar figures.`,
    ``,
    `STYLE:`,
    `  - Leadership vocabulary: "Gap to Plan", "flashing N% to Plan" (negative = behind, positive = beating), "Status quo from last week" for no movement.`,
    `  - Do NOT restate the raw dollar figures verbatim. They appear above and below this paragraph already. Reference direction and magnitude qualitatively ("widened materially", "modestly improved", "flat through the quarter").`,
    `  - Honest. If the trajectory is flat, say so. If we have only one snapshot, say so explicitly (do not fabricate a trend).`,
    `  - First person plural ("we", "the team"). Past tense for what changed; present tense for the current read.`,
    ``,
    `TRAJECTORY SERIES (${seriesSpan}, oldest first):`,
    trajectoryTable,
    ``,
    `Reply with ONLY the paragraph. No preamble, no signoff, no markdown.`,
  ].join('\n');
}

function usd(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function signedUsd(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
}

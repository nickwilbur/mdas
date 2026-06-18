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
import { gleanForRequest, type GleanClient } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type { ForecastTrajectory, TrajectoryPoint } from './forecast-trajectory';
import { cleanGleanChatReply } from './clean-glean-chat-reply';
import { flashToPlanPct, planPerformancePctLabel } from './forecast-plan-kpi';

const FAILURE_MARKER_PREFIX = '[Narrative unavailable — Glean call failed';

function failureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `${FAILURE_MARKER_PREFIX}: ${cleaned}]`
    : `${FAILURE_MARKER_PREFIX}]`;
}

/**
 * Generate the Health Snapshot narrative for the selected quarter.
 * Returns a plain text string ready to pass to `generateWeeklyForecast`.
 */
export async function generateHealthSnapshot(
  req: Request,
  trajectory: ForecastTrajectory,
  sharedClient?: GleanClient,
): Promise<string> {
  return runOneNarrative(
    req,
    trajectory.currentQuarter,
    trajectory.asOfDate,
    sharedClient,
  );
}

/** @deprecated Use `generateHealthSnapshot` — kept for import stability. */
export const generateHealthSnapshots = generateHealthSnapshot;

async function runOneNarrative(
  req: Request,
  points: TrajectoryPoint[],
  asOfDate: string,
  sharedClient?: GleanClient,
): Promise<string> {
  if (points.length === 0) {
    // Nothing to summarize — no snapshots in the quarter yet (cold
    // start, or asOfDate landed in a quarter we haven't refreshed
    // into). Return empty so the renderer omits the block entirely
    // rather than spending a Glean call to produce filler copy.
    return '';
  }
  try {
    const prompt = buildPrompt(points, asOfDate);
    const client = sharedClient ?? (await gleanForRequest(req)).client;
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = cleanGleanChatReply(reply.text);
    if (!text) return failureMarker('empty reply from Glean chat');
    return text;
  } catch (err) {
    // Log structured for ops, but never throw — a Glean outage must
    // not block the manager from pasting the rest of the script
    // into the leadership call.
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.healthSnapshot.glean_failed', {
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
  points: TrajectoryPoint[],
  asOfDate: string,
): string {
  const label = points[0]!.kpis.fiscalQuarterLabel;
  const quarterPhrase = `the selected quarter (${label})`;
  const trajectoryTable = points
    .map((p) => {
      const k = p.kpis;
      const flash = signedUsd(k.flashUSD);
      const plan = k.planUSD != null ? signedUsd(k.planUSD) : 'unknown';
      const gap = k.gapUSD != null ? signedUsd(k.gapUSD) : 'unknown';
      const hedge = usd(k.hedgeUSD);
      const total = signedUsd(k.totalRiskUSD);
      const pct = flashToPlanPct(k.flashUSD, k.planUSD);
      const pctStr = pct != null ? `${pct.toFixed(0)}%` : 'n/a';
      const planStatus = planStatusLabel(k.flashUSD, k.planUSD);
      const pctLabel = planPerformancePctLabel(k.flashUSD, k.planUSD) ?? 'n/a';
      return `${p.date} | Plan ${plan} | Flash ${flash} | %ToPlan ${pctStr} (${pctLabel}) | PlanStatus ${planStatus} | Gap ${gap} | TotalRisk ${total} | Hedge ${hedge} | Red ${k.redAccountCount} | Yellow ${k.yellowAccountCount} | Accounts ${k.accountCount}`;
    })
    .join('\n');

  const latest = points[points.length - 1]!.kpis;
  const latestPct = flashToPlanPct(latest.flashUSD, latest.planUSD);
  const latestStatus = planStatusLabel(latest.flashUSD, latest.planUSD);

  const firstDay = points[0]!.date;
  const lastDay = points[points.length - 1]!.date;
  const seriesSpan =
    points.length === 1
      ? `one snapshot (cold start: ${firstDay})`
      : `${points.length} snapshots from ${firstDay} through ${lastDay}`;

  const latestPctStr =
    latestPct != null ? `${latestPct.toFixed(0)}%` : 'n/a';

  return [
    `You are a Zuora Customer Success Executive (CSE) manager for the Expand 3 franchise, writing the qualitative "Health Snapshot" paragraph that sits inside a weekly churn/downsell forecast script the leadership team reads on a Wednesday call.`,
    ``,
    `WRITE: a 3-5 sentence paragraph (no bullets, no markdown, plaintext only) that answers:`,
    `  1. How healthy is ${quarterPhrase} (${label}) as of today (${asOfDate})?`,
    `  2. How is it trending across the snapshots so far this quarter?`,
    `  3. One subjective callout that is NOT obvious from the dollar figures.`,
    ``,
    `LATEST SNAPSHOT (authoritative — do not contradict):`,
    `  PlanStatus = ${latestStatus}`,
    `  %ToPlan = ${latestPctStr} (|Flash| / |Plan| × 100)`,
    `  If PlanStatus is OVER plan, we are behind the loss budget — NEVER say "ahead of plan", "under the loss budget", "beating plan", or "favorably under plan".`,
    `  If PlanStatus is UNDER plan, we are beating the loss budget — NEVER say "over plan" or "behind the loss budget".`,
    ``,
    `TONE CALIBRATION — read this carefully:`,
    `  Churn/Downsell Plan and Flash are NEGATIVE numbers (they are losses we plan to absorb). %ToPlan is |Flash| / |Plan| × 100. 100% means Flash exactly equals Plan. Higher % = losing MORE than budgeted (worse); lower % = losing LESS than budgeted (better). Calibrate language to the bucket:`,
    `    < 100%  beating plan — confident, "ahead of plan", "tracking favorably", "under the loss budget"`,
    `    100-105% on track — "in line with plan", "tracking close to plan", "manageable variance"`,
    `    105-115% manageable variance — "modestly over plan", "small gap to close"; do NOT call this "unhealthy"`,
    `    115-130% needs attention — "over plan", "real gap to close", "need to compress risk"`,
    `    > 130%   at risk — "materially over plan", "significant gap"`,
    `  Default to neutral-to-confident framing when UNDER plan. When OVER plan, lead with the gap honestly before any offsetting positives. Never use catastrophic words ("unhealthy", "thinner margin for error", "worsened materially", "in trouble") unless the bucket is "needs attention" or worse.`,
    ``,
    `STYLE:`,
    `  - Leadership vocabulary: "Gap to Plan", "flashing N% to Plan" (use the latest %ToPlan; e.g. "flashing 105% to plan" = 5% over the loss budget = behind, "flashing 87% to plan" = beating), "Status quo from last week" for no movement, "Path to Improve" for hedge capture.`,
    `  - Do NOT restate the raw dollar figures verbatim. They appear above and below this paragraph already. Reference direction and magnitude qualitatively, scaled to the bucket above.`,
    `  - Honest. If the trajectory is flat, say so. If we have only one snapshot, say so explicitly (do not fabricate a trend).`,
    `  - First person plural ("we", "the team"). Past tense for what changed; present tense for the current read.`,
    `  - Avoid hedge-fund alarm words ("materially worsened", "thinner margin", "deteriorated"). Use plain-English magnitude words ("slightly", "modestly", "meaningfully", "materially") that match the bucket.`,
    ``,
    `TRAJECTORY SERIES (${seriesSpan}, oldest first):`,
    trajectoryTable,
    ``,
    `Reply with ONLY the paragraph. No preamble, no signoff, no markdown.`,
  ].join('\n');
}

/**
 * `% to Plan` per the leadership churn-call vocabulary:
 *
 *   pct = |Flash| / |Plan| × 100
 *
 *   - 100% means Flash exactly equals Plan.
 *   - >100% means we're forecasting to lose MORE than Plan ("over
 *     the loss budget" → bad).
 *   - <100% means we're forecasting to lose LESS than Plan ("under
 *     the loss budget" → beating plan → good).
 *
 * This matches `formatGapToPlan` in the renderer and Sam Lawley's
 * "Flashing 137% to plan" prior art (verified 2026-05-20).
 *
 * Returns null when Plan is unknown or zero (zero-Plan would divide
 * by zero; null lets the prompt render "n/a" and the model treats
 * the quarter as cold-start).
 */
function usd(n: number): string {
  if (n === 0) return '$0';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function signedUsd(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
}

function planStatusLabel(
  flashUSD: number,
  planUSD: number | null | undefined,
): string {
  if (planUSD == null) return 'unknown';
  const gap = flashUSD - planUSD;
  if (gap === 0) return 'AT plan';
  return gap > 0 ? 'UNDER plan (beating)' : 'OVER plan (behind)';
}

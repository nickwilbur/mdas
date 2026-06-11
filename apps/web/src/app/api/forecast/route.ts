import { NextResponse } from 'next/server';
import {
  generateWeeklyForecast,
  keySavesAccountContexts,
  closeGapAccountContexts,
  mlOverrideMismatchContexts,
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  type ForecastInput,
  type GleanFlaggedRisk,
  type CloseGapActionPlan,
} from '@mdas/forecast-generator';
import type { AccountView } from '@mdas/canonical';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import { loadForecastTrajectory } from '@/lib/forecast-trajectory';
import { generateHealthSnapshots } from '@/lib/forecast-narrative';
import { generateAccountContext } from '@/lib/forecast-account-context';
import {
  generateGleanFlaggedRisks,
  type QuarterAccountUniverse,
} from '@/lib/forecast-glean-risks';
import { generateCloseGapActionPlans } from '@/lib/forecast-close-gap-plan';
import { generateMlOverrideMismatchContext } from '@/lib/forecast-ml-override-mismatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function narrativeFailureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `[Narrative unavailable — Glean call failed: ${cleaned}]`
    : `[Narrative unavailable — Glean call failed]`;
}

/**
 * Display label for the quarter containing (or following) `asOfDate`.
 * Used to ground the per-account Glean prompt in the same vocabulary
 * the rendered script uses ("FY27 Q2" not "2026-08").
 */
function quarterLabel(asOfDate: string, which: 'current' | 'next'): string {
  if (which === 'current') {
    const fq = fiscalQuarterFromDate(asOfDate);
    return fq ? fiscalQuarterLabel(fq.key) : 'Current Quarter';
  }
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  const fq = fiscalQuarterFromDate(d.toISOString());
  return fq ? fiscalQuarterLabel(fq.key) : 'Next Quarter';
}

/**
 * Build the bounded universes for the Glean-flagged-emerging-risks
 * identify call. One universe per quarter, each enumerating the
 * accounts whose opportunities fall in that quarter. The
 * `alreadyStructurallyFlagged` flag tells Glean which accounts to
 * IGNORE — anything already on the deterministic Confirmed Churn /
 * Saveable Risk path is by definition on the manager's read; we want
 * Glean to surface accounts that the structured filter missed.
 *
 * The structural-flag check mirrors the renderer's
 * `isChurnSaveTarget` lens (renewal + carried + down-forecast
 * signal) so the universe matches what the manager will read on the
 * pasted script. We also mark Confirmed Churn / Saveable Risk
 * bucket accounts as structurally flagged because those already
 * show up in the deterministic structured sections.
 */
function buildQuarterUniverses(
  views: AccountView[],
  asOfDate: string,
): QuarterAccountUniverse[] {
  const todayFq = fiscalQuarterFromDate(asOfDate);
  if (!todayFq) return [];
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  const nextFq = fiscalQuarterFromDate(d.toISOString());

  const buckets: Record<'current' | 'next', QuarterAccountUniverse> = {
    current: {
      quarter: 'current',
      fiscalQuarterLabel: fiscalQuarterLabel(todayFq.key),
      accounts: [],
    },
    next: {
      quarter: 'next',
      fiscalQuarterLabel: nextFq ? fiscalQuarterLabel(nextFq.key) : 'Next Quarter',
      accounts: [],
    },
  };
  const seen: Record<'current' | 'next', Set<string>> = {
    current: new Set(),
    next: new Set(),
  };

  for (const v of views) {
    for (const o of v.opportunities) {
      const oppFq = fiscalQuarterFromDate(o.closeDate);
      if (!oppFq) continue;
      let target: 'current' | 'next' | null = null;
      if (oppFq.key === todayFq.key) target = 'current';
      else if (nextFq && oppFq.key === nextFq.key) target = 'next';
      if (!target) continue;
      const id = v.account.accountId;
      if (seen[target].has(id)) continue;
      seen[target].add(id);
      const isRenewal = String(o.type ?? '').toLowerCase().includes('renewal');
      const cat = String(o.forecastCategory ?? '').trim().toLowerCase();
      const droppedCat =
        cat === '' ||
        cat === 'omit' ||
        cat === 'omitted' ||
        cat === 'closed' ||
        cat === 'closed lost' ||
        cat === 'closed won';
      const ml = o.forecastMostLikelyOverride ?? o.forecastMostLikely;
      const downForecast =
        (o.knownChurnUSD ?? 0) > 0 ||
        (ml != null && ml < 0) ||
        (o.acvDelta != null && o.acvDelta < 0);
      const churnSaveTarget = isRenewal && !droppedCat && downForecast;
      const inDeterministicBucket =
        v.bucket === 'Confirmed Churn' || v.bucket === 'Saveable Risk';
      buckets[target].accounts.push({
        accountId: id,
        accountName: v.account.accountName,
        alreadyStructurallyFlagged: churnSaveTarget || inDeterministicBucket,
      });
    }
  }
  return [buckets.current, buckets.next].filter((u) => u.accounts.length > 0);
}

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
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('forecast.healthSnapshot.failed', {
        asOfDate,
        message,
      });
      healthSnapshot = {
        currentQuarter: narrativeFailureMarker(message),
        nextQuarter: narrativeFailureMarker(message),
      };
    }

    // Per 2026-05-21 user feedback: each Key Saves bullet should
    // carry a 1-2 sentence qualitative "why this is on the list"
    // blurb from Glean (Slack / Gmail / account plans / CSE notes /
    // meeting transcripts), and the "not yet hedged" block should
    // get a sibling "Glean-flagged emerging risks" sub-section. Both
    // are bounded to the accounts the deterministic pipeline already
    // sees, so the leadership read stays grounded.
    //
    // These calls are independent of Health Snapshot — kept in their
    // own try blocks so one Glean outage doesn't blank everything,
    // and a missing structured field on a single account doesn't
    // poison the whole batch. Concurrency is capped inside
    // `generateAccountContext` so Glean never gets a thundering herd.
    let accountContext: Record<string, string> | undefined;
    try {
      const currentCtxs = keySavesAccountContexts(views, asOfDate, 'current');
      const nextCtxs = keySavesAccountContexts(views, asOfDate, 'next');
      const currentLabel = quarterLabel(asOfDate, 'current');
      const nextLabel = quarterLabel(asOfDate, 'next');
      const [currMap, nextMap] = await Promise.all([
        generateAccountContext(req, currentCtxs, asOfDate, currentLabel),
        generateAccountContext(req, nextCtxs, asOfDate, nextLabel),
      ]);
      // The two maps key on accountId; merging is safe because an
      // account that appears in both quarters legitimately gets the
      // same blurb (Glean has no way to know which quarter we asked
      // about beyond the prompt header, and the bullet is the same).
      accountContext = { ...nextMap, ...currMap };
      if (Object.keys(accountContext).length === 0) accountContext = undefined;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('forecast.accountContext.failed', { asOfDate, message });
      accountContext = undefined;
    }

    let gleanFlaggedRisks: GleanFlaggedRisk[] | undefined;
    try {
      const universes = buildQuarterUniverses(views, asOfDate);
      gleanFlaggedRisks = await generateGleanFlaggedRisks(
        req,
        universes,
        asOfDate,
      );
      if (gleanFlaggedRisks.length === 0) gleanFlaggedRisks = undefined;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('forecast.gleanFlaggedRisks.failed', { asOfDate, message });
      gleanFlaggedRisks = undefined;
    }

    // Per 2026-05-29 user feedback: each account in the "Accounts to
    // Close Gap" section gets a Glean-generated owner→action plan,
    // regenerated every run. Same failure isolation as the other Glean
    // calls — an outage leaves the structured bullets intact and the
    // renderer emits a per-account stale-marker.
    let closeGapActionPlans: Record<string, CloseGapActionPlan> | undefined;
    try {
      const currentCtxs = closeGapAccountContexts(views, asOfDate, 'current');
      const nextCtxs = closeGapAccountContexts(views, asOfDate, 'next');
      const currentLabel = quarterLabel(asOfDate, 'current');
      const nextLabel = quarterLabel(asOfDate, 'next');
      const [currMap, nextMap] = await Promise.all([
        generateCloseGapActionPlans(req, currentCtxs, asOfDate, currentLabel),
        generateCloseGapActionPlans(req, nextCtxs, asOfDate, nextLabel),
      ]);
      // Merge by accountId. An account appearing in both quarters gets
      // the current-quarter plan (current is the manager's live focus).
      closeGapActionPlans = { ...nextMap, ...currMap };
      if (Object.keys(closeGapActionPlans).length === 0) {
        closeGapActionPlans = undefined;
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('forecast.closeGapActionPlans.failed', { asOfDate, message });
      closeGapActionPlans = undefined;
    }

    let mlOverrideMismatchContext: Record<string, string> | undefined;
    try {
      const currentMl = mlOverrideMismatchContexts(views, asOfDate, 'current');
      const nextMl = mlOverrideMismatchContexts(views, asOfDate, 'next');
      const currentLabel = quarterLabel(asOfDate, 'current');
      const nextLabel = quarterLabel(asOfDate, 'next');
      const [currMlMap, nextMlMap] = await Promise.all([
        generateMlOverrideMismatchContext(req, currentMl, asOfDate, currentLabel),
        generateMlOverrideMismatchContext(req, nextMl, asOfDate, nextLabel),
      ]);
      mlOverrideMismatchContext = { ...nextMlMap, ...currMlMap };
      if (Object.keys(mlOverrideMismatchContext).length === 0) {
        mlOverrideMismatchContext = undefined;
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('forecast.mlOverrideMismatch.failed', { asOfDate, message });
      mlOverrideMismatchContext = undefined;
    }

    const text = generateWeeklyForecast({
      views,
      changeEvents: events,
      asOfDate,
      plan: body.plan,
      clariManagerForecastCsv: body.clariManagerForecastCsv,
      healthSnapshot,
      accountContext,
      gleanFlaggedRisks,
      closeGapActionPlans,
      mlOverrideMismatchContext,
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

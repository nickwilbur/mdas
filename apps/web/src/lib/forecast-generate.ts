// Server-only forecast orchestration with optional progress callbacks.
// Extracted from the route so POST can stream NDJSON progress events
// to the Generate Script UI while Glean calls run.
import 'server-only';
import {
  generateWeeklyForecast,
  keySavesAccountContexts,
  closeGapAccountContexts,
  mlOverrideMismatchContexts,
  fiscalQuarterFromDate,
  fiscalQuarterLabel,
  computeQuarterKpis,
  type ForecastInput,
  type GleanFlaggedRisk,
  type CloseGapActionPlan,
  type MlOverrideMismatchEnrichment,
} from '@mdas/forecast-generator';
import type { AccountView } from '@mdas/canonical';
import {
  getDashboardData,
  getWoWChangeEvents,
} from '@/lib/read-model';
import { loadForecastTrajectory } from '@/lib/forecast-trajectory';
import { overlayAuthoritativeTrajectoryKpis } from '@/lib/forecast-trajectory-kpis';
import { generateHealthSnapshot } from '@/lib/forecast-narrative';
import { generateAccountContext } from '@/lib/forecast-account-context';
import {
  generateGleanFlaggedRisks,
  type QuarterAccountUniverse,
} from '@/lib/forecast-glean-risks';
import { generateCloseGapActionPlans } from '@/lib/forecast-close-gap-plan';
import { generateMlOverrideMismatchContext } from '@/lib/forecast-ml-override-mismatch';
import { gleanForRequest, type GleanClient } from '@/lib/glean-server';

export interface ForecastGenerateProgress {
  step: string;
  label: string;
  pct: number;
}

export interface ForecastGenerateBody {
  asOfDate: string;
  plan?: { currentQuarterUSD?: number };
  clariManagerForecastCsv?: string;
}

export interface ForecastGenerateResult {
  text: string;
  asOfDate: string;
}

function narrativeFailureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `[Narrative unavailable — Glean call failed: ${cleaned}]`
    : `[Narrative unavailable — Glean call failed]`;
}

function selectedQuarterLabel(asOfDate: string): string {
  const fq = fiscalQuarterFromDate(asOfDate);
  return fq ? fiscalQuarterLabel(fq.key) : 'Selected Quarter';
}

function buildQuarterUniverse(
  views: AccountView[],
  asOfDate: string,
): QuarterAccountUniverse | null {
  const todayFq = fiscalQuarterFromDate(asOfDate);
  if (!todayFq) return null;

  const universe: QuarterAccountUniverse = {
    quarter: 'current',
    fiscalQuarterLabel: fiscalQuarterLabel(todayFq.key),
    accounts: [],
  };
  const seen = new Set<string>();

  for (const v of views) {
    for (const o of v.opportunities) {
      const oppFq = fiscalQuarterFromDate(o.closeDate);
      if (!oppFq || oppFq.key !== todayFq.key) continue;
      const id = v.account.accountId;
      if (seen.has(id)) continue;
      seen.add(id);
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
      universe.accounts.push({
        accountId: id,
        accountName: v.account.accountName,
        alreadyStructurallyFlagged: churnSaveTarget || inDeterministicBucket,
      });
    }
  }
  return universe.accounts.length > 0 ? universe : null;
}

export async function generateForecastScript(
  req: Request,
  body: ForecastGenerateBody,
  onProgress?: (update: ForecastGenerateProgress) => void,
): Promise<ForecastGenerateResult> {
  const { asOfDate } = body;
  const progress = (step: string, label: string, pct: number): void => {
    onProgress?.({ step, label, pct });
  };

  progress('data', 'Loading account data…', 8);
  const [{ views, refreshId, startedAt }, { events }] = await Promise.all([
    getDashboardData(),
    getWoWChangeEvents(),
  ]);
  const forecastViews = views;
  const latestRefreshMeta = {
    refreshId: refreshId ?? '',
    refreshStartedAt:
      typeof startedAt === 'string'
        ? startedAt
        : startedAt != null
          ? new Date(startedAt as string | Date).toISOString()
          : `${asOfDate}T12:00:00.000Z`,
  };
  progress('data', 'Account data loaded', 18);

  // One GleanClient per forecast request — each instance holds an MCP
  // session + docCache; creating one per enrichment phase was spiking
  // heap on POST /api/forecast.
  let sharedGleanClient: GleanClient | undefined;
  try {
    sharedGleanClient = (await gleanForRequest(req)).client;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('forecast.glean.client_failed', {
      asOfDate,
      message: (err as Error)?.message ?? String(err),
    });
  }

  const quarterLabel = selectedQuarterLabel(asOfDate);

  let healthSnapshot: ForecastInput['healthSnapshot'] | undefined;
  progress('health', 'Health snapshot (Glean)…', 22);
  try {
    const trajectory = await loadForecastTrajectory(
      asOfDate,
      body.plan,
      body.clariManagerForecastCsv,
      {
        latestViews: forecastViews,
        latestRefresh: latestRefreshMeta,
      },
    );
    const planUSD = body.plan?.currentQuarterUSD ?? null;
    const authoritativeKpis = computeQuarterKpis(
      forecastViews,
      asOfDate,
      'current',
      planUSD,
    );
    const trajectoryForNarrative = overlayAuthoritativeTrajectoryKpis(
      trajectory,
      authoritativeKpis,
      latestRefreshMeta,
    );
    healthSnapshot = await generateHealthSnapshot(
      req,
      trajectoryForNarrative,
      sharedGleanClient,
    );
    if (!healthSnapshot?.trim()) healthSnapshot = undefined;
    progress('health', 'Health snapshot complete', 38);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.healthSnapshot.failed', { asOfDate, message });
    healthSnapshot = narrativeFailureMarker(message);
    progress('health', 'Health snapshot unavailable', 38);
  }

  let accountContext: Record<string, string> | undefined;
  progress('context', 'Key Saves context (Glean)…', 42);
  try {
    const ctxs = keySavesAccountContexts(forecastViews, asOfDate, 'current');
    accountContext = await generateAccountContext(
      req,
      ctxs,
      asOfDate,
      quarterLabel,
      sharedGleanClient,
    );
    if (Object.keys(accountContext).length === 0) accountContext = undefined;
    progress('context', 'Key Saves context complete', 56);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.accountContext.failed', { asOfDate, message });
    accountContext = undefined;
    progress('context', 'Key Saves context skipped', 56);
  }

  let gleanFlaggedRisks: GleanFlaggedRisk[] | undefined;
  progress('risks', 'Emerging risks (Glean)…', 60);
  try {
    const universe = buildQuarterUniverse(forecastViews, asOfDate);
    gleanFlaggedRisks = universe
      ? await generateGleanFlaggedRisks(
          req,
          [universe],
          asOfDate,
          sharedGleanClient,
        )
      : undefined;
    if (!gleanFlaggedRisks?.length) gleanFlaggedRisks = undefined;
    progress('risks', 'Emerging risks complete', 70);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.gleanFlaggedRisks.failed', { asOfDate, message });
    gleanFlaggedRisks = undefined;
    progress('risks', 'Emerging risks skipped', 70);
  }

  let closeGapActionPlans: Record<string, CloseGapActionPlan> | undefined;
  progress('closeGap', 'Close-gap action plans (Glean)…', 74);
  try {
    const ctxs = closeGapAccountContexts(forecastViews, asOfDate, 'current');
    closeGapActionPlans = await generateCloseGapActionPlans(
      req,
      ctxs,
      asOfDate,
      quarterLabel,
      sharedGleanClient,
    );
    if (Object.keys(closeGapActionPlans).length === 0) {
      closeGapActionPlans = undefined;
    }
    progress('closeGap', 'Close-gap action plans complete', 86);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.closeGapActionPlans.failed', { asOfDate, message });
    closeGapActionPlans = undefined;
    progress('closeGap', 'Close-gap action plans skipped', 86);
  }

  let mlOverrideMismatchContext:
    | Record<string, MlOverrideMismatchEnrichment>
    | undefined;
  progress('mlMismatch', 'ML override context (Glean)…', 90);
  try {
    const mlCtxs = mlOverrideMismatchContexts(forecastViews, asOfDate, 'current');
    mlOverrideMismatchContext = await generateMlOverrideMismatchContext(
      req,
      mlCtxs,
      asOfDate,
      quarterLabel,
      sharedGleanClient,
    );
    if (Object.keys(mlOverrideMismatchContext).length === 0) {
      mlOverrideMismatchContext = undefined;
    }
    progress('mlMismatch', 'ML override context complete', 96);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.mlOverrideMismatch.failed', { asOfDate, message });
    mlOverrideMismatchContext = undefined;
    progress('mlMismatch', 'ML override context skipped', 96);
  }

  progress('render', 'Rendering script…', 98);
  const text = generateWeeklyForecast({
    views: forecastViews,
    changeEvents: events,
    asOfDate,
    activityAsOfDate: new Date().toISOString().slice(0, 10),
    plan: body.plan,
    clariManagerForecastCsv: body.clariManagerForecastCsv,
    healthSnapshot,
    accountContext,
    gleanFlaggedRisks,
    closeGapActionPlans,
    mlOverrideMismatchContext,
  });
  progress('render', 'Script ready', 100);

  return { text, asOfDate };
}

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
  type ForecastInput,
  type GleanFlaggedRisk,
  type CloseGapActionPlan,
  type MlOverrideMismatchEnrichment,
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

export interface ForecastGenerateProgress {
  step: string;
  label: string;
  pct: number;
}

export interface ForecastGenerateBody {
  asOfDate: string;
  plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
  clariManagerForecastCsv?: string;
}

export interface ForecastGenerateResult {
  text: string;
  asOfDate: string;
}

/** Prefix account-scoped Glean maps so current/next quarter values cannot collide. */
function namespaceAccountMap<T extends Record<string, unknown>>(
  map: T,
  quarter: 'current' | 'next',
): T {
  return Object.fromEntries(
    Object.entries(map).map(([accountId, value]) => [`${quarter}:${accountId}`, value]),
  ) as T;
}

function narrativeFailureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `[Narrative unavailable — Glean call failed: ${cleaned}]`
    : `[Narrative unavailable — Glean call failed]`;
}

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
  const [{ views }, { events }] = await Promise.all([
    getDashboardData(),
    getWoWChangeEvents(),
  ]);
  progress('data', 'Account data loaded', 18);

  let healthSnapshot: ForecastInput['healthSnapshot'] | undefined;
  progress('health', 'Health snapshot (Glean)…', 22);
  try {
    const trajectory = await loadForecastTrajectory(
      asOfDate,
      body.plan,
      body.clariManagerForecastCsv,
    );
    healthSnapshot = await generateHealthSnapshots(req, trajectory);
    progress('health', 'Health snapshot complete', 38);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.healthSnapshot.failed', { asOfDate, message });
    healthSnapshot = {
      currentQuarter: narrativeFailureMarker(message),
      nextQuarter: narrativeFailureMarker(message),
    };
    progress('health', 'Health snapshot unavailable', 38);
  }

  let accountContext: Record<string, string> | undefined;
  progress('context', 'Key Saves context (Glean)…', 42);
  try {
    const currentCtxs = keySavesAccountContexts(views, asOfDate, 'current');
    const nextCtxs = keySavesAccountContexts(views, asOfDate, 'next');
    const currentLabel = quarterLabel(asOfDate, 'current');
    const nextLabel = quarterLabel(asOfDate, 'next');
    const [currMap, nextMap] = await Promise.all([
      generateAccountContext(req, currentCtxs, asOfDate, currentLabel),
      generateAccountContext(req, nextCtxs, asOfDate, nextLabel),
    ]);
    accountContext = {
      ...namespaceAccountMap(nextMap, 'next'),
      ...namespaceAccountMap(currMap, 'current'),
    };
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
    const universes = buildQuarterUniverses(views, asOfDate);
    gleanFlaggedRisks = await generateGleanFlaggedRisks(req, universes, asOfDate);
    if (gleanFlaggedRisks.length === 0) gleanFlaggedRisks = undefined;
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
    const currentCtxs = closeGapAccountContexts(views, asOfDate, 'current');
    const nextCtxs = closeGapAccountContexts(views, asOfDate, 'next');
    const currentLabel = quarterLabel(asOfDate, 'current');
    const nextLabel = quarterLabel(asOfDate, 'next');
    const [currMap, nextMap] = await Promise.all([
      generateCloseGapActionPlans(req, currentCtxs, asOfDate, currentLabel),
      generateCloseGapActionPlans(req, nextCtxs, asOfDate, nextLabel),
    ]);
    closeGapActionPlans = {
      ...namespaceAccountMap(nextMap, 'next'),
      ...namespaceAccountMap(currMap, 'current'),
    };
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
  progress('render', 'Script ready', 100);

  return { text, asOfDate };
}

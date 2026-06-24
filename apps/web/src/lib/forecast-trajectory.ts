// Server-only helper that walks every successful MDAS snapshot taken
// since the start of the current fiscal quarter and computes a KPI
// snapshot per *calendar day* (deduping multiple same-day refreshes
// by taking the LAST one of that day — matches how leadership reads
// the trajectory: "where we were Monday vs where we are today",
// without my dev-day debug refreshes inflating the series).
//
// The series is consumed by `forecast-narrative.ts` to build the
// Glean Adaptive chat prompt for the per-quarter Health Snapshot
// narrative; it is not surfaced anywhere else in the app today, but
// the shape is intentionally generic so it can also power a
// trajectory chart in the dashboard later.
//
// Performance note: this is O(N_days) snapshot reads on each
// /api/forecast call. For a 13-week quarter with daily refreshes
// that's ~65 reads of (snapshot_account, snapshot_opportunity)
// payloads. Acceptable for a manual "Generate Update" button click;
// if we wire this into a cron-pulled dashboard we should memoize
// per-snapshot KPIs to the `account_view` row or a sibling table.
import 'server-only';
import {
  listSuccessfulRunsSince,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  type RefreshRun,
} from '@mdas/db';
import { buildAccountView } from '@mdas/scoring';
import {
  computeQuarterKpis,
  fiscalQuarterFromDate,
  fiscalQuarterStart,
  parseClariManagerForecastExportCsv,
  selectLatestClariForecastValue,
  supplementViewsWithDroppedQuarterChurnOpps,
  timeframeMatchesFiscalQuarter,
} from '@mdas/forecast-generator';
import type { AccountView, CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { loadChurnOpportunitySupplementFromRecentRefreshes } from '@/lib/read-model';
import { toIsoString } from '@/lib/to-iso-string';

/**
 * One trajectory point — KPI snapshot for a single quarter at a
 * single date. Bundles both the calendar day (for the narrative
 * "Monday → Today" framing) and the underlying refresh metadata so
 * downstream readers can decide whether to trust the point.
 */
export interface TrajectoryPoint {
  /** Calendar day of the snapshot (YYYY-MM-DD, UTC). */
  date: string;
  /** The refresh run id this point was computed from. */
  refreshId: string;
  /** Wall-clock start time of the refresh (ISO). */
  refreshStartedAt: string;
  /** KPI snapshot for the quarter at this date. */
  kpis: QuarterKpiSnapshot;
}

/**
 * Per-quarter trajectory series for both quarters the forecast script
 * renders: the quarter containing `asOfDate` (`current`) and the
 * following quarter (`next`).
 */
export interface ForecastTrajectory {
  asOfDate: string;
  currentQuarter: TrajectoryPoint[];
  nextQuarter: TrajectoryPoint[];
}

/**
 * Optional planUSD inputs forwarded by the caller. Mirrors the
 * `plan` field on `ForecastInput` so trajectory KPIs are computed
 * with the same plan dollars the rendered script uses (otherwise
 * Gap to Plan would be `null` for every trajectory point and the
 * narrative would have nothing to compare against).
 */
export interface TrajectoryPlanInput {
  currentQuarterUSD?: number;
}

/**
 * Load all per-day KPI snapshots since the start of the fiscal
 * quarter containing `asOfDate`.
 *
 * Returns empty arrays (not null) when no snapshots are available so
 * the caller can render a no-trajectory narrative without a defensive
 * null check. The Glean prompt builder treats an empty series as "no
 * history to anchor against" and the LLM produces a snapshot-only
 * read of the current week.
 */
export async function loadForecastTrajectory(
  asOfDate: string,
  plan?: TrajectoryPlanInput,
  clariManagerForecastCsv?: string,
): Promise<ForecastTrajectory> {
  const currentFq = fiscalQuarterFromDate(asOfDate);
  if (!currentFq) {
    return { asOfDate, currentQuarter: [], nextQuarter: [] };
  }
  const sinceIso = `${fiscalQuarterStart(currentFq)}T00:00:00Z`;
  const runs = await listSuccessfulRunsSince(sinceIso);
  if (runs.length === 0) {
    return { asOfDate, currentQuarter: [], nextQuarter: [] };
  }

  // Dedupe to "last refresh of each calendar day". Map preserves
  // insertion order, but we walk newest-first and only keep the
  // first hit per day → guaranteed to grab the last-of-day refresh.
  //
  // pg hydrates timestamptz columns to JS Date by default, even
  // though our RefreshRun interface narrows the type to `string`
  // (the JSON-serialized representation the API uses). Coerce to
  // ISO before slicing so this works regardless of whether the row
  // came back as Date (live DB query) or string (JSON round-trip).
  const lastPerDay = new Map<string, { day: string; startedAtIso: string; run: RefreshRun }>();
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const r = runs[i]!;
    const startedAtIso = toIsoString(r.started_at);
    const day = startedAtIso.slice(0, 10);
    if (!lastPerDay.has(day)) lastPerDay.set(day, { day, startedAtIso, run: r });
  }
  const orderedDays = Array.from(lastPerDay.keys()).sort();

  // Parse Clari CSV once — Plan for a quarter rarely changes within
  // a quarter, so use the latest pasted Plan as the trajectory's
  // Plan even for older snapshots. (We don't have historical Clari
  // exports stored.) Caller-supplied `plan` always wins.
  const clariRows = clariManagerForecastCsv
    ? parseClariManagerForecastExportCsv(clariManagerForecastCsv)
    : [];
  const clariCurrentPlan = clariSelectionPlan(clariRows, currentFq.key);

  const currentPoints: TrajectoryPoint[] = [];
  const latestDay = orderedDays[orderedDays.length - 1];

  for (const day of orderedDays) {
    const entry = lastPerDay.get(day)!;
    const { run, startedAtIso } = entry;

    let views: AccountView[];
    try {
      views = await buildViewsForRun(run.id);
      if (day === latestDay) {
        const prior = await loadChurnOpportunitySupplementFromRecentRefreshes(run.id);
        views = supplementViewsWithDroppedQuarterChurnOpps(
          views,
          prior,
          asOfDate,
          buildAccountView,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('forecast.trajectory.buildViews.failed', {
        refreshId: run.id,
        day,
        message: (err as Error)?.message,
      });
      continue;
    }

    const resolvedCurrentPlan = plan?.currentQuarterUSD ?? clariCurrentPlan;
    try {
      const currentKpis = computeQuarterKpis(
        views,
        asOfDate,
        'current',
        resolvedCurrentPlan ?? null,
      );
      if (currentKpis.fiscalQuarterKey) {
        currentPoints.push({
          date: day,
          refreshId: run.id,
          refreshStartedAt: startedAtIso,
          kpis: currentKpis,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('forecast.trajectory.currentKpis.failed', {
        refreshId: run.id,
        day,
        message: (err as Error)?.message,
      });
    }
  }

  return { asOfDate, currentQuarter: currentPoints, nextQuarter: [] };
}

// Build AccountView[] for a historical refresh from its raw
// snapshot rows. We deliberately do NOT call readAccountViews(run.id)
// here even though it's cheaper — historical `account_view` rows
// may have been written by an older scoring version with a different
// bucket/risk model, which would make the trajectory series
// inconsistent with what the current code thinks "red" means.
// Re-scoring from the raw account+opp payloads guarantees the
// trajectory uses the same logic the renderer is using *right now*.
async function buildViewsForRun(refreshId: string): Promise<AccountView[]> {
  const [accounts, opportunities] = await Promise.all([
    readSnapshotAccounts(refreshId),
    readSnapshotOpportunities(refreshId),
  ]);
  const accountsById = new Map<string, CanonicalAccount>();
  for (const a of accounts) accountsById.set(a.accountId, a);
  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of opportunities) {
    const arr = oppsByAccount.get(o.accountId) ?? [];
    arr.push(o);
    oppsByAccount.set(o.accountId, arr);
  }
  const views: AccountView[] = [];
  for (const a of accountsById.values()) {
    if (a.franchise !== 'Expand 3') continue;
    views.push(buildAccountView(a, oppsByAccount.get(a.accountId) ?? []));
  }
  return views;
}

// ---------- Clari Plan lookup (mirrors index.ts's clariSelectionForQuarter) ----------

const CLARI_ROLE = 'FLM Expand 3';
const CLARI_DATA_TYPE = 'Forecast Value';

function clariSelectionPlan(
  rows: ReturnType<typeof parseClariManagerForecastExportCsv>,
  fiscalQuarterKey: string,
): number | undefined {
  if (!fiscalQuarterKey) return undefined;
  const sel = selectLatestClariForecastValue(rows, {
    role: CLARI_ROLE,
    timeframeMatches: (tf) => timeframeMatchesFiscalQuarter(tf, fiscalQuarterKey),
    field: 'Churn/Downsell Plan',
    dataType: CLARI_DATA_TYPE,
  });
  return sel?.clariForecastValue;
}

function nextKeyFrom(asOfDate: string): string {
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  const fq = fiscalQuarterFromDate(d.toISOString());
  return fq?.key ?? '';
}

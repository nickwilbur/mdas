// Server-only read helpers. Pages read ONLY from local Postgres (account_view + snapshot_*).
import 'server-only';
import {
  latestSuccessfulRun,
  listRefreshRuns,
  previousSuccessfulRun,
  readAccountView,
  readAccountViews,
  readAuditLog,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  query,
} from '@mdas/db';
import type { AccountView, CanonicalOpportunity, ChangeEvent } from '@mdas/canonical';
import { diffAll, computeRiskScore } from '@mdas/scoring';

// PR-B1 — enrich views with the composite Risk Score at read time.
//
// We compute on read rather than at write time because the score uses
// WoW change events (one of 8 signals), which are themselves a read-time
// join across two snapshots. Doing this in the worker would require
// duplicating that join into the orchestrator. Read-time enrichment
// keeps the worker contract simple and lets us evolve signal weights
// without re-running the worker.
//
// Performance: O(views) with a one-time Map keyed by accountId for
// O(1) event lookup. Negligible vs. the Postgres round-trip.
function enrichViewsWithRiskScore(
  views: AccountView[],
  events: ChangeEvent[],
): AccountView[] {
  const eventsByAccount = new Map<string, ChangeEvent[]>();
  for (const e of events) {
    const list = eventsByAccount.get(e.accountId) ?? [];
    list.push(e);
    eventsByAccount.set(e.accountId, list);
  }
  return views.map((v) => {
    const rs = computeRiskScore({
      account: v.account,
      opportunities: v.opportunities,
      changeEvents: eventsByAccount.get(v.account.accountId) ?? [],
    });
    return { ...v, riskScore: rs };
  });
}

export async function getLatestRunId(): Promise<string | null> {
  const r = await latestSuccessfulRun();
  return r?.id ?? null;
}

export async function getDashboardData(): Promise<{
  views: AccountView[];
  refreshId: string | null;
  startedAt: string | null;
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { views: [], refreshId: null, startedAt: null };
  // PR-B1: load views + WoW events in parallel so the read path can
  // enrich every view with the composite Risk Score in one DB pass.
  const [views, wow] = await Promise.all([
    readAccountViews(run.id),
    getWoWChangeEvents(),
  ]);
  // Filter to only Expand 3 franchise
  const filteredViews = views.filter(v => v.account.franchise === 'Expand 3');
  filteredViews.sort((a, b) => a.priorityRank - b.priorityRank);
  const enriched = enrichViewsWithRiskScore(filteredViews, wow.events);
  return { views: enriched, refreshId: run.id, startedAt: run.started_at };
}

export async function getAccount(accountId: string): Promise<AccountView | null> {
  const run = await latestSuccessfulRun();
  if (!run) return null;
  const view = await readAccountView(run.id, accountId);
  if (!view) return null;
  // PR-B1: drill-in needs the same enrichment so the explainer card
  // sees the composite RiskScore. The events feed is small enough to
  // pull globally and let enrichViewsWithRiskScore filter by accountId.
  const wow = await getWoWChangeEvents();
  const [enriched] = enrichViewsWithRiskScore([view], wow.events);
  return enriched ?? view;
}

export async function getWoWChangeEvents(): Promise<{
  events: ChangeEvent[];
  currId: string | null;
  prevId: string | null;
}> {
  const curr = await latestSuccessfulRun();
  if (!curr) return { events: [], currId: null, prevId: null };
  const prev = await previousSuccessfulRun(curr.id);
  if (!prev) return { events: [], currId: curr.id, prevId: null };

  const [currA, currO, prevA, prevO] = await Promise.all([
    readSnapshotAccounts(curr.id),
    readSnapshotOpportunities(curr.id),
    readSnapshotAccounts(prev.id),
    readSnapshotOpportunities(prev.id),
  ]);
  const events = diffAll(
    { accounts: prevA, opportunities: prevO },
    { accounts: currA, opportunities: currO },
    prev.id,
    curr.id,
  );
  return { events, currId: curr.id, prevId: prev.id };
}

export async function getRecentRuns(limit = 20) {
  return listRefreshRuns(limit);
}

/**
 * Aggregate per-source freshness across all accounts in the most recent
 * successful run. Reads `payload->'lastFetchedFromSource'` from every
 * snapshot_account row and returns the most recent timestamp per source
 * plus the count of accounts that had data from that source.
 *
 * The previous implementation showed the run's completed_at for every
 * source, which masked partial failures (e.g. SF ran fine, but Cerebro
 * 401'd halfway through and only enriched 12/236 accounts). Now we
 * surface that asymmetry directly.
 */
export async function getPerSourceFreshness(): Promise<{
  refreshId: string | null;
  perSource: { source: string; latest: string | null; accountsTouched: number }[];
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { refreshId: null, perSource: [] };
  // jsonb_each_text yields (key, value) pairs from the freshness map.
  // Aggregate per key across all account rows in this refresh.
  const r = await query<{ source: string; latest: string | null; accounts_touched: string }>(
    `
    SELECT
      kv.key                         AS source,
      MAX(kv.value)                  AS latest,
      COUNT(DISTINCT s.account_id)   AS accounts_touched
    FROM snapshot_account s,
         LATERAL jsonb_each_text(COALESCE(s.payload->'lastFetchedFromSource', '{}'::jsonb)) AS kv
    WHERE s.refresh_id = $1
    GROUP BY kv.key
    ORDER BY kv.key
    `,
    [run.id],
  );
  return {
    refreshId: run.id,
    perSource: r.rows.map((row) => ({
      source: row.source,
      latest: row.latest,
      accountsTouched: Number(row.accounts_touched),
    })),
  };
}

export async function getAuditTail(limit = 80) {
  return readAuditLog(limit);
}

// ----- Data quality (F-06) -----
//
// Per-account, per-source freshness with ARR exposure for the latest
// successful refresh. Powers the /admin/data-quality surface so a
// manager can see "how much ARR is sitting on stale or missing data
// from each integration."
//
// SLA buckets:
//   fresh   : last fetch ≤ 7d   (matches isStale() in components/time.ts)
//   stale   : last fetch > 7d
//   error   : adapter recorded a non-fatal error this refresh
//   missing : no entry for this source on this account
const STALE_AFTER_DAYS = 7;

export type DataQualityState = 'fresh' | 'stale' | 'error' | 'missing';

export interface SourceQualityRow {
  source: string;
  fresh: { count: number; arr: number };
  stale: { count: number; arr: number };
  error: { count: number; arr: number };
  missing: { count: number; arr: number };
}

export interface FieldQualityRow {
  /** Canonical field path on CanonicalAccount or CanonicalOpportunity. */
  field: string;
  /** Description of "missing" rule for the field. */
  description: string;
  /** Accounts that fail the rule, with their ARR. */
  missingCount: number;
  missingARR: number;
  /** Total accounts evaluated. */
  total: number;
}

export interface DataQualitySummary {
  refreshId: string | null;
  startedAt: string | null;
  totalAccounts: number;
  totalARR: number;
  perSource: SourceQualityRow[];
  perField: FieldQualityRow[];
}

function dqStateForIso(iso: string | null, errored: boolean, asOf: number): DataQualityState {
  if (errored) return 'error';
  if (!iso) return 'missing';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'missing';
  return asOf - t > STALE_AFTER_DAYS * 86400_000 ? 'stale' : 'fresh';
}

function blank(): SourceQualityRow {
  return {
    source: '',
    fresh: { count: 0, arr: 0 },
    stale: { count: 0, arr: 0 },
    error: { count: 0, arr: 0 },
    missing: { count: 0, arr: 0 },
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function getDataQuality(): Promise<DataQualitySummary> {
  const run = await latestSuccessfulRun();
  if (!run) {
    return { refreshId: null, startedAt: null, totalAccounts: 0, totalARR: 0, perSource: [], perField: [] };
  }
  const [accounts, opps] = await Promise.all([
    readSnapshotAccounts(run.id),
    readSnapshotOpportunities(run.id),
  ]);
  const inFranchise = accounts.filter((a) => a.franchise === 'Expand 3');
  const totalAccounts = inFranchise.length;
  const totalARR = inFranchise.reduce((s, a) => s + (a.allTimeARR ?? 0), 0);

  // Discover the canonical source set from the data + the well-known
  // expected sources so we still show 0/0 rows for adapters that never
  // touched any account this refresh (a meaningful signal in its own right).
  const observed = new Set<string>();
  for (const a of inFranchise) {
    for (const k of Object.keys(a.lastFetchedFromSource ?? {})) observed.add(k);
    for (const k of Object.keys(a.sourceErrors ?? {})) observed.add(k);
  }
  const expected: string[] = ['salesforce', 'cerebro', 'gainsight', 'glean-mcp'];
  for (const s of expected) observed.add(s);
  const sources = Array.from(observed).sort();

  const asOf = Date.now();
  const bySource = new Map<string, SourceQualityRow>(
    sources.map((s) => [s, { ...blank(), source: s }]),
  );
  for (const a of inFranchise) {
    const arr = a.allTimeARR ?? 0;
    for (const s of sources) {
      const iso = a.lastFetchedFromSource?.[s as keyof typeof a.lastFetchedFromSource] ?? null;
      const errored = !!a.sourceErrors?.[s as keyof typeof a.sourceErrors];
      const state = dqStateForIso(iso, errored, asOf);
      const row = bySource.get(s)!;
      row[state].count += 1;
      row[state].arr += arr;
    }
  }

  // Field-level critical-data presence: ranked by ARR-exposed.
  // Each field rule is defined here so the policy is in one place.
  const oppsByAccount = new Map<string, typeof opps>();
  for (const o of opps) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }
  const fieldRules: {
    field: string;
    description: string;
    missing: (a: typeof inFranchise[number]) => boolean;
  }[] = [
    {
      field: 'cseSentimentCommentary',
      description: 'Account has no CSE sentiment commentary.',
      missing: (a) => !asString(a.cseSentimentCommentary).trim(),
    },
    {
      field: 'cseSentimentCommentaryLastUpdated',
      description: 'Sentiment commentary last-updated stamp is missing.',
      missing: (a) => !a.cseSentimentCommentaryLastUpdated,
    },
    {
      field: 'opp.flmNotes',
      description: 'No FLM Notes on any open opportunity.',
      missing: (a) => {
        const list = oppsByAccount.get(a.accountId) ?? [];
        if (list.length === 0) return false; // no opps → not missing
        return list.every((o) => !asString(o.flmNotes).trim());
      },
    },
    {
      field: 'opp.scNextSteps',
      description: 'No SC/SE next steps on any open opportunity.',
      missing: (a) => {
        const list = oppsByAccount.get(a.accountId) ?? [];
        if (list.length === 0) return false;
        return list.every((o) => !asString(o.scNextSteps).trim());
      },
    },
    {
      field: 'recentMeetings',
      description: 'No recent meetings recorded.',
      missing: (a) => (a.recentMeetings?.length ?? 0) === 0,
    },
  ];

  const perField: FieldQualityRow[] = fieldRules.map((rule) => {
    let count = 0;
    let arr = 0;
    for (const a of inFranchise) {
      if (rule.missing(a)) {
        count += 1;
        arr += a.allTimeARR ?? 0;
      }
    }
    return {
      field: rule.field,
      description: rule.description,
      missingCount: count,
      missingARR: arr,
      total: totalAccounts,
    };
  });
  // Sort by ARR-exposed descending — managers care about money first.
  perField.sort((a, b) => b.missingARR - a.missingARR);

  return {
    refreshId: run.id,
    startedAt: run.started_at,
    totalAccounts,
    totalARR,
    perSource: Array.from(bySource.values()),
    perField,
  };
}

export async function getAllOpportunities(): Promise<{
  opportunities: CanonicalOpportunity[];
  accounts: Map<string, import('@mdas/canonical').CanonicalAccount>;
  refreshId: string | null;
  startedAt: string | null;
}> {
  const run = await latestSuccessfulRun();
  if (!run) return { opportunities: [], accounts: new Map(), refreshId: null, startedAt: null };
  const [opportunities, accountSnapshots] = await Promise.all([
    readSnapshotOpportunities(run.id),
    query<{ account_id: string; payload: import('@mdas/canonical').CanonicalAccount }>(
      `SELECT account_id, payload FROM snapshot_account WHERE refresh_id = $1`,
      [run.id],
    ),
  ]);

  // Filter: 36 months forward, 15 months trailing from today
  const now = new Date();
  const minDate = new Date(now);
  minDate.setMonth(minDate.getMonth() - 15);
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 36);

  const filteredOpps = opportunities.filter(opp => {
    const closeDate = new Date(opp.closeDate);
    return closeDate >= minDate && closeDate <= maxDate;
  });
  
  // Sort by close date
  filteredOpps.sort((a, b) => new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime());

  // Create account map from snapshot accounts
  const accountMap = new Map<string, import('@mdas/canonical').CanonicalAccount>();
  for (const acc of accountSnapshots.rows) {
    accountMap.set(acc.account_id, acc.payload);
  }

  return { opportunities: filteredOpps, accounts: accountMap, refreshId: run.id, startedAt: run.started_at };
}

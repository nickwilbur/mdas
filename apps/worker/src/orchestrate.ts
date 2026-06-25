// Refresh orchestrator: fetch → normalize → persist → score → diff → publish.
import type {
  AccountView,
  AdapterAuditLogger,
  AdapterLogger,
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
  ReadAdapter,
  RefreshContext,
  SourceLink,
} from '@mdas/canonical';
import { filterExpand3Snapshot, dedupeSourceLinksByUrl, mergeRecentMeetings } from '@mdas/canonical';
import {
  attachRefreshRunToJob,
  audit,
  baselineRunForWindow,
  completeRefreshRun,
  latestSuccessfulRun,
  pruneOldRuns,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  startRefreshRun,
  writeAccountViews,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
  replaceSnapshotAccounts,
  replaceSnapshotOpportunities,
  replaceAccountViews,
  updateRefreshTrajectoryKpis,
} from '@mdas/db';
import {
  // SCORING_VERSION, // TODO: Fix module resolution issue
  buildAccountView,
  diffAll,
  rankAccountViews,
} from '@mdas/scoring';
import { log } from './logger.js';
import { ProgressTracker } from './progress-tracker.js';
import { salesforceAdapter } from '@mdas/adapter-salesforce';
import { cerebroRestAdapter, shouldRunCerebroGleanFallback } from '@mdas/adapter-cerebro-rest';
import { cerebroGleanAdapter } from '@mdas/adapter-cerebro-glean';
import { gainsightAdapter } from '@mdas/adapter-gainsight';
import { staircaseGmailAdapter } from '@mdas/adapter-staircase-gmail';
import { zuoraMcpAdapter } from '@mdas/adapter-zuora-mcp';
import { gleanMcpAdapter } from '@mdas/adapter-glean-mcp';
import { GleanClient, readGleanCredsFromEnv } from '@mdas/adapter-glean-mcp';
import { localSnapshotsAdapter } from '@mdas/adapter-local-snapshots';
import { applySalesforceAuthoritativeSnapshot } from './salesforce-authoritative.js';
import {
  runCoordinatedGleanEnrichment,
  shouldUseCoordinatedGleanLoop,
} from './glean-coordinator.js';

export { applySalesforceAuthoritativeSnapshot } from './salesforce-authoritative.js';

// Adapter execution order matters: mergeAdapterResults() does a
// last-write-wins spread on scalar fields (so adapters scheduled LATER
// override earlier ones on shared canonical fields like account name,
// sentiment, owner). Provenance/freshness fields
// (`lastFetchedFromSource`, `sourceErrors`, `sourceLinks`) are
// deep-merged instead — see mergeAccount() / mergeOpportunity().
//
// Policy (see "Data sources & precedence" in README.md):
//   1. localSnapshots is ALWAYS first as the baseline so unattended
//      refreshes don't wipe state when no real source produces a record.
//   2. Glean-backed enrichment adapters (cerebro, gainsight, glean-mcp)
//      run mid-pipeline. They populate fields no other source surfaces
//      (AI risk analysis, recent meetings, account plans, CTAs).
//   3. Other secondary adapters (staircase, zuora-mcp) run after Glean
//      enrichment but before SF.
//   4. Salesforce runs LAST so its values override every other source
//      on shared fields. Salesforce is the system of truth for
//      account name, owner, CSE assignment, sentiment, opportunity
//      stage/amount, etc.
//
// Adapters keyed by env-var name (set to 'real' to include in the
// pipeline; anything else / unset → omitted, no mock fallback).
// Order in this array determines execution order.
const REAL_ADAPTERS: ReadonlyArray<readonly [string, ReadAdapter]> = [
  // REST first (direct Cerebro Engage API token); Glean fallback second.
  ['ADAPTER_CEREBRO', cerebroRestAdapter],
  ['ADAPTER_CEREBRO', cerebroGleanAdapter],
  ['ADAPTER_GAINSIGHT', gainsightAdapter],
  ['ADAPTER_GLEAN_MCP', gleanMcpAdapter],
  ['ADAPTER_STAIRCASE', staircaseGmailAdapter],
  ['ADAPTER_ZUORA_MCP', zuoraMcpAdapter],
  ['ADAPTER_SALESFORCE', salesforceAdapter],
];

export function selectActiveAdapters(): ReadAdapter[] {
  const adapters: ReadAdapter[] = [localSnapshotsAdapter];
  for (const [envKey, real] of REAL_ADAPTERS) {
    if ((process.env[envKey] ?? '').toLowerCase() !== 'real') continue;
    if (real.name === 'cerebro-glean' && !shouldRunCerebroGleanFallback()) continue;
    adapters.push(real);
  }
  return adapters;
}

const FRANCHISE = 'Expand 3';

// PR-B3 — F-17: per-adapter timeout, configurable via env.
//
// Today's adapters fetch in batch (one SOQL/MCP query per franchise),
// not per-account, so the meaningful unit of soft-cap is the adapter
// invocation. The existing hardcoded 25_000ms cap was per-deploy with
// no override; in production we've seen the Glean MCP adapter exceed
// 25s on cold-start days, which silently caused the whole pipeline to
// fall back to localSnapshots for that source.
//
// Now:
//   - `ADAPTER_TIMEOUT_MS` (default 25000) sets the global cap.
//   - `ADAPTER_TIMEOUT_MS_<UPPERCASE_SOURCE>` overrides per source
//     (e.g. `ADAPTER_TIMEOUT_MS_GLEAN_MCP=60000`).
//   - On timeout we emit a distinct "timed out after Nms" error string
//     (instead of generic "adapter timeout") so the partial-success
//     surface introduced in PR-A4 can render "salesforce timed out
//     after 25000ms" rather than a vague "failed".
const DEFAULT_ADAPTER_TIMEOUT_MS = 25_000;

// glean-mcp fans out ~4 Glean searches per account. When it runs in
// parallel with cerebro + gainsight they share one process-wide rate
// limiter and all three stall. Defer glean-mcp until the other adapters
// finish so it gets the full throughput budget.
const DEFERRED_GLEAN_SOURCES = new Set(['glean-mcp']);

/** Split adapters for phased fetch; exported for unit tests. */
export function partitionAdaptersForFetch(adapters: ReadAdapter[]): {
  immediate: ReadAdapter[];
  /** cerebro-glean runs after cerebro-rest when both are active. */
  deferredCerebroGlean: ReadAdapter[];
  deferred: ReadAdapter[];
} {
  const hasCerebroRest = adapters.some((a) => a.name === 'cerebro-rest');
  const immediate: ReadAdapter[] = [];
  const deferredCerebroGlean: ReadAdapter[] = [];
  const deferred: ReadAdapter[] = [];
  for (const a of adapters) {
    const source = a.source ?? a.name;
    if (DEFERRED_GLEAN_SOURCES.has(source)) {
      deferred.push(a);
    } else if (a.name === 'cerebro-glean' && hasCerebroRest) {
      deferredCerebroGlean.push(a);
    } else {
      immediate.push(a);
    }
  }
  return { immediate, deferredCerebroGlean, deferred };
}

/** Build Glean-fallback skip list from cerebro-rest results this refresh. */
export function buildCerebroRestCoverage(
  restResult: Partial<MergedData> | undefined,
  restAttempted: boolean,
): RefreshContext['cerebroRestCoverage'] | undefined {
  if (!restAttempted) return undefined;
  const enrichedAccountIds: string[] = [];
  for (const a of restResult?.accounts ?? []) {
    if (a.cerebroRiskCategory || a.cerebroRiskAnalysis?.trim()) {
      enrichedAccountIds.push(a.accountId);
    }
  }
  return { restAttempted: true, enrichedAccountIds };
}

function adapterTimeoutMs(source: string): number {
  const envKey = `ADAPTER_TIMEOUT_MS_${source.toUpperCase().replace(/-/g, '_')}`;
  const override = process.env[envKey];
  if (override) {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const global = process.env.ADAPTER_TIMEOUT_MS;
  if (global) {
    const n = Number(global);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_ADAPTER_TIMEOUT_MS;
}

interface MergedData {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

/**
 * Fill in array/object defaults on accounts that came in via a single
 * adapter (e.g. salesforce-only accounts that aren't in the
 * localSnapshots fixture). The canonical type marks these fields as
 * non-nullable, but adapters emit Partial<CanonicalAccount> records,
 * so a downstream scoring/diffing crash is possible if no adapter
 * touched the field. This normalizer keeps scoring naive.
 */
function withAccountDefaults(a: CanonicalAccount): CanonicalAccount {
  return {
    ...a,
    // `lastUpdated` is NOT NULL in snapshot_account.captured_at. Glean
    // enrichment adapters (cerebro, gainsight, glean-mcp) emit account
    // partials without lastUpdated when they discover an accountId not
    // produced by SFDC/local-snapshots. Default to "now" so the snapshot
    // write doesn't blow up the whole refresh.
    lastUpdated: a.lastUpdated ?? new Date().toISOString(),
    workshops: a.workshops ?? [],
    recentMeetings: a.recentMeetings ?? [],
    accountPlanLinks: a.accountPlanLinks ?? [],
    gainsightTasks: a.gainsightTasks ?? [],
    sourceLinks: a.sourceLinks ?? [],
    activeProductLines: a.activeProductLines ?? [],
    cerebroSubMetrics: a.cerebroSubMetrics ?? {},
    cerebroRisks:
      a.cerebroRisks ?? {
        utilizationRisk: null,
        engagementRisk: null,
        suiteRisk: null,
        shareRisk: null,
        legacyTechRisk: null,
        expertiseRisk: null,
        pricingRisk: null,
      },
    lastFetchedFromSource: a.lastFetchedFromSource ?? {},
  };
}

/**
 * Naive last-write-wins shallow merge is correct for scalar canonical
 * fields (Salesforce wins on account name, sentiment, owner, etc. — see
 * REAL_ADAPTERS execution order above). But a handful of fields are
 * *additive* across adapters and would be silently destroyed by a plain
 * `{ ...existing, ...a }` spread:
 *
 *   - `lastFetchedFromSource` — each adapter emits `{ <itsSource>: ts }`,
 *     so a shallow spread by the last adapter (salesforce) erases every
 *     other source's freshness stamp. Symptom: /admin/data-quality shows
 *     0 fresh accounts for cerebro / gainsight / glean-mcp even when the
 *     adapters ran successfully.
 *   - `sourceErrors` — same shape, same risk; per-source error pills in
 *     the UI would be wiped by a later successful adapter.
 *   - `sourceLinks` — each adapter contributes one (or more) citation
 *     link for the Account Drill-In; a shallow spread keeps only the
 *     last adapter's link.
 *
 * We deep-merge those three fields here so provenance/freshness is
 * preserved while still keeping last-write-wins for every other field.
 *
 * `sourceLinks` is deduped by URL (later adapter wins) so consecutive
 * refreshes do not append duplicate citations — without this, each
 * adapter re-emitting the same SFDC / Glean link grows snapshot JSONB
 * without bound and the worker retains ever-larger payloads per refresh.
 */
export function mergeSourceLinks(
  existing: SourceLink[] | undefined,
  next: SourceLink[] | undefined,
): SourceLink[] {
  return dedupeSourceLinksByUrl(existing, next);
}

/** Observability helper: surface snapshot citation bloat after merge. */
export function summarizeSourceLinkCounts(data: MergedData): {
  accounts: number;
  opportunities: number;
  maxSourceLinksPerAccount: number;
  maxSourceLinksPerOpportunity: number;
  totalSourceLinks: number;
} {
  let maxSourceLinksPerAccount = 0;
  let totalSourceLinks = 0;
  for (const a of data.accounts) {
    const n = a.sourceLinks?.length ?? 0;
    totalSourceLinks += n;
    if (n > maxSourceLinksPerAccount) maxSourceLinksPerAccount = n;
  }
  let maxSourceLinksPerOpportunity = 0;
  for (const o of data.opportunities) {
    const n = o.sourceLinks?.length ?? 0;
    totalSourceLinks += n;
    if (n > maxSourceLinksPerOpportunity) maxSourceLinksPerOpportunity = n;
  }
  return {
    accounts: data.accounts.length,
    opportunities: data.opportunities.length,
    maxSourceLinksPerAccount,
    maxSourceLinksPerOpportunity,
    totalSourceLinks,
  };
}

function mergeAccount(
  existing: CanonicalAccount,
  next: CanonicalAccount,
): CanonicalAccount {
  return {
    ...existing,
    ...next,
    lastFetchedFromSource: {
      ...(existing.lastFetchedFromSource ?? {}),
      ...(next.lastFetchedFromSource ?? {}),
    },
    sourceErrors: {
      ...(existing.sourceErrors ?? {}),
      ...(next.sourceErrors ?? {}),
    },
    sourceLinks: mergeSourceLinks(existing.sourceLinks, next.sourceLinks),
    recentMeetings: mergeRecentMeetings(existing.recentMeetings, next.recentMeetings ?? []),
  };
}

function mergeOpportunity(
  existing: CanonicalOpportunity,
  next: CanonicalOpportunity,
): CanonicalOpportunity {
  return {
    ...existing,
    ...next,
    lastFetchedFromSource: {
      ...(existing.lastFetchedFromSource ?? {}),
      ...(next.lastFetchedFromSource ?? {}),
    },
    sourceErrors: {
      ...(existing.sourceErrors ?? {}),
      ...(next.sourceErrors ?? {}),
    },
    sourceLinks: mergeSourceLinks(existing.sourceLinks, next.sourceLinks),
  };
}

function mergeAdapterResults(
  results: { accounts?: CanonicalAccount[]; opportunities?: CanonicalOpportunity[] }[],
): MergedData {
  const accountsMap = new Map<string, CanonicalAccount>();
  const oppsMap = new Map<string, CanonicalOpportunity>();
  for (const r of results) {
    for (const a of r.accounts ?? []) {
      const existing = accountsMap.get(a.accountId);
      accountsMap.set(a.accountId, existing ? mergeAccount(existing, a) : a);
    }
    for (const o of r.opportunities ?? []) {
      const existing = oppsMap.get(o.opportunityId);
      oppsMap.set(o.opportunityId, existing ? mergeOpportunity(existing, o) : o);
    }
  }
  return {
    accounts: [...accountsMap.values()].map(withAccountDefaults),
    opportunities: [...oppsMap.values()],
  };
}

/**
 * Per-adapter / per-section outcome surfaced alongside the run-level
 * status. Mirrors the `RefreshSectionResult<T>` shape requested by the
 * dashboard refresh contract: data lives in the snapshot tables (we do
 * not duplicate payloads here), but every other field a UI needs to
 * render "partially refreshed / last-known-good" is included.
 */
export interface RefreshSectionResult {
  source: string;
  status: 'success' | 'failed';
  durationMs: number;
  /** Number of canonical accounts contributed by this adapter. */
  accounts: number;
  /** Number of canonical opportunities contributed by this adapter. */
  opportunities: number;
  /** Error message when status === 'failed'. */
  error?: string;
  /** ISO timestamp the adapter completed (success or failure). */
  refreshedAt: string;
}

export interface RefreshResult {
  refreshId: string;
  status: 'success' | 'partial' | 'failed';
  rowCounts: Record<string, number>;
  durationMs: number;
  /**
   * Per-adapter breakdown. Additive — existing callers that destructure
   * { refreshId, status, rowCounts, durationMs } still work. New surfaces
   * (job-status API, refresh button toast, /admin/data-quality) can now
   * show "salesforce: 240 accts in 3.2s; cerebro: failed after 25s" without
   * a join against refresh_runs.error_log.
   */
  sections: RefreshSectionResult[];
}

/**
 * Build the RefreshContext threaded through every adapter call. Logger and
 * audit are thin wrappers over the structured `log` (PR-B4) and @mdas/db.
 *
 * The bound `refreshId` (and optional `requestId` from the API caller)
 * appears on every record emitted by an adapter — that's the trace
 * identifier persisted across web → worker.
 */
function buildRefreshContext(
  refreshId: string,
  asOf: Date,
  requestId?: string,
): RefreshContext {
  // PR-B4: structured JSON-on-stdout logger; fields are bound once
  // and inherited by every adapter log line so the collector can
  // group by refresh.
  const child = log.child({
    refreshId,
    ...(requestId ? { requestId } : {}),
  });
  const logger: AdapterLogger = {
    info: (msg, meta) => child.info(msg, meta as Record<string, unknown> | undefined),
    warn: (msg, meta) => child.warn(msg, meta as Record<string, unknown> | undefined),
    error: (msg, meta) => child.error(msg, meta as Record<string, unknown> | undefined),
  };
  const auditLogger: AdapterAuditLogger = {
    record: async (a, e, d) => {
      await audit(a, e, { refreshId, ...(requestId ? { requestId } : {}), ...d });
    },
  };
  return {
    refreshId,
    asOf,
    franchise: FRANCHISE,
    logger,
    audit: auditLogger,
  };
}

export async function runRefresh(
  // PR-B4: requestId is the optional web-→-worker correlation id.
  // Generated by the API route on POST /api/refresh, persisted on the
  // refresh_jobs row, and threaded into every audit + log record so
  // a manager can find their refresh in worker logs by request-id.
  //
  // jobId, when supplied, is the refresh_jobs row to link to this run.
  // Today the worker passes jobId === requestId (the job id is the
  // request id). refresh-once.ts and unit tests omit it. Setting the
  // FK at start-of-run (instead of at completeJob) is what makes
  // GET /api/refresh/{jobId} return live progress mid-run instead of
  // returning progress=null until the very last frame.
  options: {
    actor?: string;
    injected?: MergedData;
    requestId?: string;
    jobId?: string;
  } = {},
): Promise<RefreshResult> {
  const start = Date.now();
  const startedAt = new Date(start);
  const adapters = selectActiveAdapters();
  const sourceNames = adapters.map((a) => a.name);

  const refreshId = await startRefreshRun({
    scoringVersion: 'v0.1.0', // TODO: Fix SCORING_VERSION import
    sources: sourceNames,
  });
  // Link the job row to the run immediately so the status API can
  // surface live progress from refresh_runs.progress while the run is
  // in flight. Best-effort: a failure here doesn't abort the refresh
  // — at worst the UI falls back to its pre-fix "0% until done" behavior.
  if (options.jobId) {
    try {
      await attachRefreshRunToJob(options.jobId, refreshId);
    } catch (err) {
      log.warn('refresh.attachJob.failed', {
        jobId: options.jobId,
        refreshId,
        error: (err as Error).message,
      });
    }
  }
  const ctx = buildRefreshContext(refreshId, startedAt, options.requestId);
  const gleanCreds = readGleanCredsFromEnv();
  const sharedGleanClient = gleanCreds ? new GleanClient(gleanCreds) : undefined;
  if (sharedGleanClient) {
    (ctx as RefreshContext & { gleanClient?: GleanClient }).gleanClient = sharedGleanClient;
  }
  const progress = new ProgressTracker(refreshId, sourceNames);

  // Per-adapter outcome buffer. Populated by the parallel fetch loop and
  // surfaced on RefreshResult.sections so the UI can render a per-source
  // status line (duration, error, row counts) without re-reading
  // refresh_runs.error_log.
  const sections: RefreshSectionResult[] = [];
  try {
    await audit(options.actor ?? 'manual:nick', 'refresh.started', {
      refreshId,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      sources: sourceNames,
    });

    progress.startFlushing();

    // Phase 0 — Prefetch prior snapshot ONCE for the whole refresh.
    //
    // Previously every Glean enrichment adapter (cerebro, gainsight,
    // glean-mcp) independently issued the same `readSnapshotAccounts(prior.id)`
    // query at the top of its `fetch()`. With ~300 accounts × 2KB JSONB
    // each, that's three identical ~600KB+ reads serialized inside the
    // worker process. Doing it once here and threading the result via
    // `ctx.priorRun` lets adapters skip the lookup entirely.
    //
    // The reads are parallel and best-effort: a failure here doesn't
    // abort the refresh (adapters will just fall back to their own
    // lookup, preserving old behavior).
    let priorRun: RefreshContext['priorRun'];
    const prefetchStart = Date.now();
    const priorMeta = await baselineRunForWindow(refreshId, 0).catch(() => null);
    if (priorMeta) {
      const [priorAccounts, priorOpps] = await Promise.all([
        readSnapshotAccounts(priorMeta.id).catch(() => [] as CanonicalAccount[]),
        readSnapshotOpportunities(priorMeta.id).catch(
          () => [] as CanonicalOpportunity[],
        ),
      ]);
      priorRun = {
        id: priorMeta.id,
        accounts: priorAccounts,
        opportunities: priorOpps,
      };
      ctx.logger.info('refresh.priorRun.prefetched', {
        priorRunId: priorMeta.id,
        accounts: priorAccounts.length,
        opportunities: priorOpps.length,
        durationMs: Date.now() - prefetchStart,
      });
    }

    const prefetchMs = Date.now() - prefetchStart;

    // Phase 1: Fetch with isolated failures. Non-glean-mcp adapters run
    // in parallel; glean-mcp is deferred to Phase 1b so it does not
    // compete with cerebro/gainsight for Glean rate-limit budget.
    const succeeded: string[] = [];
    const errorLog: { source: string; error: string }[] = [];
    const fetchPhaseStart = Date.now();
    const { immediate, deferredCerebroGlean, deferred } = partitionAdaptersForFetch(adapters);

    async function fetchOneAdapter(
      a: ReadAdapter,
      adapterCtxOverride?: RefreshContext,
    ): Promise<Partial<MergedData>> {
      const source = a.source ?? a.name;
      const adapterStart = Date.now();
      const timeoutMs = adapterTimeoutMs(source);
      const adapterCtx: RefreshContext = adapterCtxOverride ?? {
        ...ctx,
        reportProgress: (current, total, label) =>
          progress.report(a.name, current, total, label),
        ...(priorRun ? { priorRun } : {}),
        ...(sharedGleanClient ? { gleanClient: sharedGleanClient } : {}),
      };
      progress.markRunning(a.name, 0);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          a.fetch({ franchise: FRANCHISE }, adapterCtx),
          new Promise<Partial<MergedData>>((_, rej) => {
            timeoutHandle = setTimeout(
              () => rej(new Error(`timed out after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        succeeded.push(a.name);
        const accountCount = r.accounts?.length ?? 0;
        const oppCount = r.opportunities?.length ?? 0;
        const durationMs = Date.now() - adapterStart;
        progress.markDone(a.name, accountCount);
        ctx.logger.info(`adapter.success`, {
          source,
          durationMs,
          accounts: accountCount,
          opportunities: oppCount,
        });
        sections.push({
          source: a.name,
          status: 'success',
          durationMs,
          accounts: accountCount,
          opportunities: oppCount,
          refreshedAt: new Date().toISOString(),
        });
        return r;
      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const message = (err as Error).message;
        const durationMs = Date.now() - adapterStart;
        errorLog.push({ source: a.name, error: message });
        progress.markError(a.name);
        ctx.logger.error(`adapter.failure`, {
          source,
          durationMs,
          error: message,
        });
        sections.push({
          source: a.name,
          status: 'failed',
          durationMs,
          accounts: 0,
          opportunities: 0,
          error: message,
          refreshedAt: new Date().toISOString(),
        });
        return {} as Partial<MergedData>;
      }
    }

    // Key by adapter NAME, not source: cerebro-rest and cerebro-glean
    // both report source 'cerebro', so keying by source made the
    // second-running adapter (cerebro-glean) overwrite the first's
    // (cerebro-rest) result in this map. That silently dropped every
    // cerebro-rest account — Risk Category + narrative never reached the
    // merge or the snapshot, surfacing as "Cerebro narrative not synced".
    const fetchResults = new Map<string, Partial<MergedData>>();
    if (immediate.length > 0) {
      const immediateResults = await Promise.all(immediate.map(fetchOneAdapter));
      immediate.forEach((a, i) => {
        fetchResults.set(a.name, immediateResults[i]!);
      });
    }
    if (deferredCerebroGlean.length > 0 || deferred.length > 0) {
      const restResult = fetchResults.get('cerebro-rest');
      const restAttempted = adapters.some((a) => a.name === 'cerebro-rest');
      const cerebroRestCoverage = buildCerebroRestCoverage(restResult, restAttempted);
      const runCerebroGlean = deferredCerebroGlean.some((a) => a.name === 'cerebro-glean');
      const runGleanMcp = deferred.some((a) => a.name === 'glean-mcp');
      const canCoordinate =
        shouldUseCoordinatedGleanLoop() &&
        sharedGleanClient &&
        runCerebroGlean &&
        runGleanMcp;

      if (canCoordinate) {
        ctx.logger.info('refresh.glean.coordinated', {
          cerebroGlean: true,
          gleanMcp: true,
        });
        const coordinatedCtx: RefreshContext = {
          ...ctx,
          ...(priorRun ? { priorRun } : {}),
          gleanClient: sharedGleanClient,
          ...(cerebroRestCoverage ? { cerebroRestCoverage } : {}),
        };
        progress.markRunning('cerebro-glean', 0);
        progress.markRunning('glean-mcp', 0);
        const coordinatedStart = Date.now();
        try {
          const coordinated = await runCoordinatedGleanEnrichment(
            sharedGleanClient,
            coordinatedCtx,
            {
              onCerebroProgress: (current, total, label) =>
                progress.report('cerebro-glean', current, total, label),
              onGleanMcpProgress: (current, total, label) =>
                progress.report('glean-mcp', current, total, label),
            },
          );
          const durationMs = Date.now() - coordinatedStart;
          fetchResults.set('cerebro-glean', coordinated.cerebroGlean);
          fetchResults.set('glean-mcp', coordinated.gleanMcp);
          succeeded.push('cerebro-glean', 'glean-mcp');
          progress.markDone('cerebro-glean', coordinated.cerebroGlean.accounts?.length ?? 0);
          progress.markDone('glean-mcp', coordinated.gleanMcp.accounts?.length ?? 0);
          for (const [name, result] of [
            ['cerebro-glean', coordinated.cerebroGlean],
            ['glean-mcp', coordinated.gleanMcp],
          ] as const) {
            sections.push({
              source: name,
              status: 'success',
              durationMs,
              accounts: result.accounts?.length ?? 0,
              opportunities: result.opportunities?.length ?? 0,
              refreshedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          const message = (err as Error).message;
          const durationMs = Date.now() - coordinatedStart;
          for (const name of ['cerebro-glean', 'glean-mcp'] as const) {
            errorLog.push({ source: name, error: message });
            progress.markError(name);
            sections.push({
              source: name,
              status: 'failed',
              durationMs,
              accounts: 0,
              opportunities: 0,
              error: message,
              refreshedAt: new Date().toISOString(),
            });
          }
          fetchResults.set('cerebro-glean', {});
          fetchResults.set('glean-mcp', {});
        }
      } else {
        if (deferredCerebroGlean.length > 0) {
          ctx.logger.info('refresh.cerebroGlean.deferred', {
            waitingFor: immediate.map((a) => a.name),
            restEnriched: cerebroRestCoverage?.enrichedAccountIds.length ?? 0,
          });
          for (const a of deferredCerebroGlean) {
            const adapterCtx: RefreshContext = {
              ...ctx,
              reportProgress: (current, total, label) =>
                progress.report(a.name, current, total, label),
              ...(priorRun ? { priorRun } : {}),
              ...(sharedGleanClient ? { gleanClient: sharedGleanClient } : {}),
              ...(cerebroRestCoverage ? { cerebroRestCoverage } : {}),
            };
            fetchResults.set(a.name, await fetchOneAdapter(a, adapterCtx));
          }
        }
        if (deferred.length > 0) {
          ctx.logger.info('refresh.gleanMcp.deferred', {
            waitingFor: [
              ...immediate.map((a) => a.name),
              ...deferredCerebroGlean.map((a) => a.name),
            ],
            deferred: deferred.map((a) => a.name),
          });
          for (const a of deferred) {
            fetchResults.set(a.name, await fetchOneAdapter(a));
          }
        }
      }
    }
    const fetched = adapters.map(
      (a) => fetchResults.get(a.name) ?? ({} as Partial<MergedData>),
    );
    const fetchMs = Date.now() - fetchPhaseStart;

  // Final progress flush before merge/score phase.
  progress.stopFlushing();
  await progress.flush();

  // Phase 2: Normalize / merge.
  const mergeStart = Date.now();
  let merged: MergedData = options.injected ?? mergeAdapterResults(fetched);
  if (!options.injected) {
    const sfResult = fetchResults.get('salesforce');
    if (succeeded.includes('salesforce') && sfResult) {
      const before = {
        accounts: merged.accounts.length,
        opportunities: merged.opportunities.length,
      };
      merged = applySalesforceAuthoritativeSnapshot(merged, sfResult, {
        asOfDate: startedAt.toISOString().slice(0, 10),
      });
      ctx.logger.info('refresh.salesforce.authoritative', {
        before,
        after: {
          accounts: merged.accounts.length,
          opportunities: merged.opportunities.length,
        },
      });
    }
  }

  const beforeExpand3 = {
    accounts: merged.accounts.length,
    opportunities: merged.opportunities.length,
  };
  merged = filterExpand3Snapshot(merged);
  ctx.logger.info('refresh.expand3.scope', {
    before: beforeExpand3,
    after: {
      accounts: merged.accounts.length,
      opportunities: merged.opportunities.length,
    },
  });
  const sourceLinkStats = summarizeSourceLinkCounts(merged);
  ctx.logger.info('refresh.merge.sourceLinks', sourceLinkStats);
  const mergeMs = Date.now() - mergeStart;

  // Phase 3 + 4 prep — parallelize three independent I/Os.
  //
  // Previously:
  //   await writeSnapshotAccounts(...)          // ~accounts/200 rows  (~150ms)
  //   await writeSnapshotOpportunities(...)     // ~opps/200 rows      (~80ms)
  //   const prev = await baselineRunForWindow(...)
  //   await readSnapshotAccounts(prev.id)       // ~150ms
  //   await readSnapshotOpportunities(prev.id)  // ~80ms
  // → serialized ~460ms.
  //
  // None of these depend on each other, so we run them concurrently and
  // gate on Promise.all. With pg's pool size ≥4 (default 10) this cuts the
  // post-fetch I/O wall time to ~150ms in practice. Errors still propagate
  // — they're all critical-path so we want them to surface.
  const diffWindowDays = Number(process.env.DIFF_WINDOW_DAYS) || 7;
  const persistStart = Date.now();
  const [, , prevRun] = await Promise.all([
    replaceSnapshotAccounts(refreshId, merged.accounts),
    replaceSnapshotOpportunities(refreshId, merged.opportunities),
    baselineRunForWindow(refreshId, diffWindowDays),
  ]);
  let prevAccounts: CanonicalAccount[] = [];
  let prevOpps: CanonicalOpportunity[] = [];
  if (prevRun) {
    // Reuse the Phase-0 prefetch when it happens to be the same run
    // (typical case: only one prior run within the diff window).
    if (priorRun && priorRun.id === prevRun.id) {
      prevAccounts = priorRun.accounts;
      prevOpps = priorRun.opportunities;
    } else {
      [prevAccounts, prevOpps] = await Promise.all([
        readSnapshotAccounts(prevRun.id),
        readSnapshotOpportunities(prevRun.id),
      ]);
    }
  }
  ctx.logger.info('refresh.persist.complete', {
    durationMs: Date.now() - persistStart,
    accounts: merged.accounts.length,
    opportunities: merged.opportunities.length,
    reusedPriorRun: priorRun != null && prevRun != null && priorRun.id === prevRun.id,
  });
  const persistMs = Date.now() - persistStart;

  const scoreStart = Date.now();

  const events: ChangeEvent[] = diffAll(
    prevRun ? { accounts: prevAccounts, opportunities: prevOpps } : null,
    merged,
    prevRun?.id ?? '',
    refreshId,
  );

  const prevAccByID = new Map(prevAccounts.map((a) => [a.accountId, a]));
  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of merged.opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }

  const views: AccountView[] = merged.accounts.map((a) =>
    buildAccountView(a, oppsByAccount.get(a.accountId) ?? [], {
      prevRiskCategory: prevAccByID.get(a.accountId)?.cerebroRiskCategory ?? undefined,
      changeEvents: events.filter((e) => e.accountId === a.accountId),
    }),
  );
  const ranked = rankAccountViews(views);
  const scoreMs = Date.now() - scoreStart;

  // Phase 6: Publish.
  const publishStart = Date.now();
  await replaceAccountViews(refreshId, ranked);
  const publishMs = Date.now() - publishStart;

  const status: 'success' | 'partial' | 'failed' =
    succeeded.length === 0 ? 'failed' : succeeded.length === adapters.length ? 'success' : 'partial';

  if (status !== 'failed') {
    try {
      const asOfDate = startedAt.toISOString().slice(0, 10);
      const { computeRefreshTrajectoryKpis } = await import('@mdas/forecast-generator');
      await updateRefreshTrajectoryKpis(
        refreshId,
        computeRefreshTrajectoryKpis(ranked, asOfDate),
      );
    } catch (err) {
      ctx.logger.warn('refresh.trajectoryKpis.failed', {
        refreshId,
        error: (err as Error).message,
      });
    }
  }

  await completeRefreshRun(refreshId, status, {
    sourcesSucceeded: succeeded,
    rowCounts: {
      accounts: merged.accounts.length,
      opportunities: merged.opportunities.length,
      account_views: ranked.length,
      change_events: events.length,
    },
    errorLog: errorLog.length ? errorLog : null,
  });

  await audit(options.actor ?? 'manual:nick', 'refresh.completed', {
    refreshId,
    status,
    rowCounts: {
      accounts: merged.accounts.length,
      opportunities: merged.opportunities.length,
      change_events: events.length,
    },
  });

  const totalDurationMs = Date.now() - start;
  ctx.logger.info('refresh.summary', {
    refreshId,
    status,
    durationMs: totalDurationMs,
    phases: {
      prefetchMs,
      fetchMs,
      mergeMs,
      persistMs,
      scoreMs,
      publishMs,
    },
    rowCounts: {
      accounts: merged.accounts.length,
      opportunities: merged.opportunities.length,
      account_views: ranked.length,
      change_events: events.length,
    },
    adapters: sections.map((s) => ({
      source: s.source,
      status: s.status,
      durationMs: s.durationMs,
      accounts: s.accounts,
      opportunities: s.opportunities,
      error: s.error,
    })),
    slowestAdapter: sections.reduce(
      (best, s) => (s.durationMs > (best?.durationMs ?? 0) ? s : best),
      sections[0],
    ),
    glean: sharedGleanClient?.searchCacheStats(),
  });

  // Retain most-recent 12; prune older.
  const pruned = await pruneOldRuns(12);
  if (pruned > 0) {
    await audit('cron', 'refresh.pruned', { pruned });
  }

  return {
    refreshId,
    status,
    rowCounts: {
      accounts: merged.accounts.length,
      opportunities: merged.opportunities.length,
      change_events: events.length,
    },
    durationMs: totalDurationMs,
    sections,
  };
  } finally {
    progress.stopFlushing();
  }
}

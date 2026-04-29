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
} from '@mdas/canonical';
import {
  audit,
  completeRefreshRun,
  latestSuccessfulRun,
  pruneOldRuns,
  readSnapshotAccounts,
  readSnapshotOpportunities,
  startRefreshRun,
  writeAccountViews,
  writeSnapshotAccounts,
  writeSnapshotOpportunities,
} from '@mdas/db';
import {
  // SCORING_VERSION, // TODO: Fix module resolution issue
  buildAccountView,
  diffAll,
  rankAccountViews,
} from '@mdas/scoring';
import { salesforceAdapter } from '@mdas/adapter-salesforce';
import { cerebroGleanAdapter } from '@mdas/adapter-cerebro-glean';
import { gainsightAdapter } from '@mdas/adapter-gainsight';
import { staircaseGmailAdapter } from '@mdas/adapter-staircase-gmail';
import { zuoraMcpAdapter } from '@mdas/adapter-zuora-mcp';
import { gleanMcpAdapter } from '@mdas/adapter-glean-mcp';
import { localSnapshotsAdapter } from '@mdas/adapter-local-snapshots';

// Adapter execution order matters: mergeAdapterResults() does a naive
// last-write-wins spread, so adapters scheduled LATER override earlier
// ones on shared canonical fields.
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
    if ((process.env[envKey] ?? '').toLowerCase() === 'real') {
      adapters.push(real);
    }
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

function mergeAdapterResults(
  results: { accounts?: CanonicalAccount[]; opportunities?: CanonicalOpportunity[] }[],
): MergedData {
  const accountsMap = new Map<string, CanonicalAccount>();
  const oppsMap = new Map<string, CanonicalOpportunity>();
  for (const r of results) {
    for (const a of r.accounts ?? []) {
      const existing = accountsMap.get(a.accountId);
      accountsMap.set(a.accountId, existing ? { ...existing, ...a } : a);
    }
    for (const o of r.opportunities ?? []) {
      const existing = oppsMap.get(o.opportunityId);
      oppsMap.set(o.opportunityId, existing ? { ...existing, ...o } : o);
    }
  }
  return {
    accounts: [...accountsMap.values()].map(withAccountDefaults),
    opportunities: [...oppsMap.values()],
  };
}

export interface RefreshResult {
  refreshId: string;
  status: 'success' | 'partial' | 'failed';
  rowCounts: Record<string, number>;
  durationMs: number;
}

/**
 * Build the RefreshContext threaded through every adapter call. Logger and
 * audit are thin wrappers over console + @mdas/db for now; can be replaced
 * with structured implementations without touching adapter code.
 */
function buildRefreshContext(refreshId: string, asOf: Date): RefreshContext {
  const tag = (level: string) => (msg: string, meta?: Record<string, unknown>) => {
    const line = meta
      ? `[${level}] [refresh=${refreshId.slice(0, 8)}] ${msg} ${JSON.stringify(meta)}`
      : `[${level}] [refresh=${refreshId.slice(0, 8)}] ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  const logger: AdapterLogger = {
    info: tag('info'),
    warn: tag('warn'),
    error: tag('error'),
  };
  const auditLogger: AdapterAuditLogger = {
    record: async (a, e, d) => {
      await audit(a, e, { refreshId, ...d });
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
  options: { actor?: string; injected?: MergedData } = {},
): Promise<RefreshResult> {
  const start = Date.now();
  const startedAt = new Date(start);
  const adapters = selectActiveAdapters();
  const sourceNames = adapters.map((a) => a.name);

  const refreshId = await startRefreshRun({
    scoringVersion: 'v0.1.0', // TODO: Fix SCORING_VERSION import
    sources: sourceNames,
  });
  const ctx = buildRefreshContext(refreshId, startedAt);
  await audit(options.actor ?? 'manual:nick', 'refresh.started', {
    refreshId,
    sources: sourceNames,
  });

  // Phase 1: Fetch in parallel with isolated failures.
  const succeeded: string[] = [];
  const errorLog: { source: string; error: string }[] = [];
  const fetched = await Promise.all(
    adapters.map(async (a) => {
      const adapterStart = Date.now();
      // PR-B3: per-adapter timeout, env-configurable. See adapterTimeoutMs.
      const timeoutMs = adapterTimeoutMs(a.source ?? a.name);
      try {
        const r = await Promise.race([
          a.fetch({ franchise: FRANCHISE }, ctx),
          new Promise<Partial<MergedData>>((_, rej) =>
            // Descriptive error message so PR-A4's partial-success surface
            // can show "salesforce timed out after 25000ms" instead of
            // a generic "failed".
            setTimeout(
              () => rej(new Error(`timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);
        succeeded.push(a.name);
        ctx.logger.info(`adapter.success`, {
          source: a.source ?? a.name,
          durationMs: Date.now() - adapterStart,
          accounts: r.accounts?.length ?? 0,
          opportunities: r.opportunities?.length ?? 0,
        });
        return r;
      } catch (err) {
        const message = (err as Error).message;
        errorLog.push({ source: a.name, error: message });
        ctx.logger.error(`adapter.failure`, {
          source: a.source ?? a.name,
          durationMs: Date.now() - adapterStart,
          error: message,
        });
        return {} as Partial<MergedData>;
      }
    }),
  );

  // Phase 2: Normalize / merge.
  let merged: MergedData = options.injected ?? mergeAdapterResults(fetched);

  // Phase 3: Persist snapshot.
  await writeSnapshotAccounts(refreshId, merged.accounts);
  await writeSnapshotOpportunities(refreshId, merged.opportunities);

  // Phase 4 & 5: Score + WoW diff.
  const prevRun = await latestSuccessfulRun();
  let prevAccounts: CanonicalAccount[] = [];
  let prevOpps: CanonicalOpportunity[] = [];
  if (prevRun && prevRun.id !== refreshId) {
    prevAccounts = await readSnapshotAccounts(prevRun.id);
    prevOpps = await readSnapshotOpportunities(prevRun.id);
  }

  const events: ChangeEvent[] = diffAll(
    prevRun && prevRun.id !== refreshId
      ? { accounts: prevAccounts, opportunities: prevOpps }
      : null,
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

  // Phase 6: Publish.
  await writeAccountViews(refreshId, ranked);

  const status: 'success' | 'partial' | 'failed' =
    succeeded.length === 0 ? 'failed' : succeeded.length === adapters.length ? 'success' : 'partial';

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
    durationMs: Date.now() - start,
  };
}

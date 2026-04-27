// Refresh orchestrator: fetch → normalize → persist → score → diff → publish.
import type {
  AccountView,
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
  ReadAdapter,
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
import {
  mockSalesforce,
  mockCerebroGlean,
  mockGainsight,
  mockStaircaseGmail,
  mockZuoraMcp,
  mockGleanMcp,
} from '@mdas/adapters-mock';
import { salesforceAdapter } from '@mdas/adapter-salesforce';
import { cerebroGleanAdapter } from '@mdas/adapter-cerebro-glean';
import { gainsightAdapter } from '@mdas/adapter-gainsight';
import { staircaseGmailAdapter } from '@mdas/adapter-staircase-gmail';
import { zuoraMcpAdapter } from '@mdas/adapter-zuora-mcp';
import { gleanMcpAdapter } from '@mdas/adapter-glean-mcp';

function pickAdapter(envKey: string, mock: ReadAdapter, real: ReadAdapter): ReadAdapter {
  const v = (process.env[envKey] ?? 'mock').toLowerCase();
  return v === 'real' ? real : mock;
}

function selectAdapters(): ReadAdapter[] {
  return [
    pickAdapter('ADAPTER_SALESFORCE', mockSalesforce, salesforceAdapter),
    pickAdapter('ADAPTER_CEREBRO', mockCerebroGlean, cerebroGleanAdapter),
    pickAdapter('ADAPTER_GAINSIGHT', mockGainsight, gainsightAdapter),
    pickAdapter('ADAPTER_STAIRCASE', mockStaircaseGmail, staircaseGmailAdapter),
    pickAdapter('ADAPTER_ZUORA_MCP', mockZuoraMcp, zuoraMcpAdapter),
    pickAdapter('ADAPTER_GLEAN_MCP', mockGleanMcp, gleanMcpAdapter),
  ];
}

const FRANCHISE = 'Expand 3';

interface MergedData {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
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
    accounts: [...accountsMap.values()],
    opportunities: [...oppsMap.values()],
  };
}

export interface RefreshResult {
  refreshId: string;
  status: 'success' | 'partial' | 'failed';
  rowCounts: Record<string, number>;
  durationMs: number;
}

export async function runRefresh(
  options: { actor?: string; injected?: MergedData } = {},
): Promise<RefreshResult> {
  const start = Date.now();
  const adapters = selectAdapters();
  const sourceNames = adapters.map((a) => a.name);

  const refreshId = await startRefreshRun({
    scoringVersion: 'v0.1.0', // TODO: Fix SCORING_VERSION import
    sources: sourceNames,
  });
  await audit(options.actor ?? 'manual:nick', 'refresh.started', {
    refreshId,
    sources: sourceNames,
  });

  // Phase 1: Fetch in parallel with isolated failures.
  const succeeded: string[] = [];
  const errorLog: { source: string; error: string }[] = [];
  const fetched = await Promise.all(
    adapters.map(async (a) => {
      try {
        const r = await Promise.race([
          a.fetch({ franchise: FRANCHISE }),
          new Promise<Partial<MergedData>>((_, rej) =>
            setTimeout(() => rej(new Error('adapter timeout')), 25_000),
          ),
        ]);
        succeeded.push(a.name);
        return r;
      } catch (err) {
        errorLog.push({ source: a.name, error: (err as Error).message });
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

// Single account loop for cerebro-glean + glean-mcp when both run in a refresh.

import type { AdapterFetchResult, CanonicalAccount, RefreshContext } from '@mdas/canonical';
import {
  mapCerebroDocsToAccountPartials,
  resolveCerebroGleanScope,
  searchCerebroDocsForAccount,
} from '@mdas/adapter-cerebro-glean';
import {
  enrichGleanMcpAccount,
  GleanClient,
  resolveGleanMcpScope,
} from '@mdas/adapter-glean-mcp';
import { mapWithConcurrency } from '../../../packages/adapters/read/_shared/src/concurrency.js';

export function shouldUseCoordinatedGleanLoop(): boolean {
  const raw = (process.env.GLEAN_COORDINATED_LOOP ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

interface CoordinatedWorkItem {
  account: CanonicalAccount;
  runCerebro: boolean;
  runGleanMcp: boolean;
}

function buildWorkQueue(
  cerebroIds: Set<string>,
  gleanIds: Set<string>,
  accountsById: Map<string, CanonicalAccount>,
): CoordinatedWorkItem[] {
  const ids = new Set<string>([...cerebroIds, ...gleanIds]);
  const queue: CoordinatedWorkItem[] = [];
  for (const id of ids) {
    const account = accountsById.get(id);
    if (!account) continue;
    queue.push({
      account,
      runCerebro: cerebroIds.has(id),
      runGleanMcp: gleanIds.has(id),
    });
  }
  return queue;
}

function resolveCoordinatedConcurrency(): number {
  const glean = Number(process.env.GLEAN_CONCURRENCY);
  const cerebro = Number(process.env.CEREBRO_CONCURRENCY);
  const n = glean || cerebro;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export interface CoordinatedGleanResult {
  cerebroGlean: Partial<AdapterFetchResult>;
  gleanMcp: Partial<AdapterFetchResult>;
}

export async function runCoordinatedGleanEnrichment(
  client: GleanClient,
  ctx: RefreshContext,
  callbacks: {
    onCerebroProgress?: (current: number, total: number, label?: string) => void;
    onGleanMcpProgress?: (current: number, total: number, label?: string) => void;
  } = {},
): Promise<CoordinatedGleanResult> {
  const refreshAt = ctx.asOf ?? new Date();
  const log = ctx.logger;

  const [cerebroScope, gleanScope] = await Promise.all([
    resolveCerebroGleanScope(ctx),
    resolveGleanMcpScope(ctx),
  ]);

  const cerebroToSearch = cerebroScope?.toSearch ?? [];
  const gleanAccounts = gleanScope?.accounts ?? [];

  const accountsById = new Map<string, CanonicalAccount>();
  for (const a of ctx.priorRun?.accounts ?? []) {
    accountsById.set(a.accountId, a);
  }
  for (const a of [...cerebroToSearch, ...gleanAccounts]) {
    accountsById.set(a.accountId, a);
  }

  const cerebroIds = new Set(cerebroToSearch.map((a) => a.accountId));
  const gleanIds = new Set(gleanAccounts.map((a) => a.accountId));
  const work = buildWorkQueue(cerebroIds, gleanIds, accountsById);

  if (work.length === 0) {
    return {
      cerebroGlean: { accounts: [], opportunities: [] },
      gleanMcp: { accounts: [], opportunities: [] },
    };
  }

  const concurrency = resolveCoordinatedConcurrency();
  log?.info('glean.coordinated.start', {
    workItems: work.length,
    cerebroAccounts: cerebroIds.size,
    gleanMcpAccounts: gleanIds.size,
    concurrency,
  });

  const startedAt = Date.now();
  let cerebroDone = 0;
  let gleanDone = 0;
  const cerebroDocs: Awaited<ReturnType<typeof searchCerebroDocsForAccount>>[] = [];
  const gleanPartials: Array<Partial<CanonicalAccount> | null> = [];

  await mapWithConcurrency(work, concurrency, async (item) => {
    const label = item.account.accountName;
    const tasks: Promise<void>[] = [];

    if (item.runCerebro) {
      tasks.push(
        searchCerebroDocsForAccount(client, item.account)
          .then((docs) => {
            cerebroDocs.push(docs);
          })
          .catch((err) => {
            log?.warn('cerebro.search.account.failed', {
              accountId: item.account.accountId,
              error: (err as Error).message,
            });
            cerebroDocs.push([]);
          })
          .finally(() => {
            callbacks.onCerebroProgress?.(++cerebroDone, cerebroIds.size, label);
          }),
      );
    }

    if (item.runGleanMcp) {
      tasks.push(
        enrichGleanMcpAccount(client, item.account, refreshAt)
          .then((partial) => {
            gleanPartials.push(partial);
          })
          .catch((err) => {
            log?.warn('glean-mcp.account.failed', {
              accountId: item.account.accountId,
              error: (err as Error).message,
            });
            gleanPartials.push(null);
          })
          .finally(() => {
            callbacks.onGleanMcpProgress?.(++gleanDone, gleanIds.size, label);
          }),
      );
    }

    await Promise.all(tasks);
  });

  const cerebroAccounts = mapCerebroDocsToAccountPartials(cerebroDocs.flat(), refreshAt);
  const gleanMcpAccounts = gleanPartials.filter(
    (p): p is Partial<CanonicalAccount> & { accountId: string } => p !== null,
  );

  log?.info('glean.coordinated.complete', {
    workItems: work.length,
    cerebroAccountsEnriched: cerebroAccounts.length,
    gleanMcpAccountsEnriched: gleanMcpAccounts.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    cerebroGlean: { accounts: cerebroAccounts as CanonicalAccount[], opportunities: [] },
    gleanMcp: { accounts: gleanMcpAccounts as CanonicalAccount[], opportunities: [] },
  };
}

// Cerebro direct REST adapter (Cerebro Engage API token).
//
// Primary production path for Cerebro health-risk enrichment. When
// CEREBRO_API_TOKEN is unset, returns empty and cerebro-glean (Glean
// federated search) remains the fallback.
//
// Transport: HTTPS REST only — MCP is IDE/discovery-only per
// docs/engineering/cerebro-connection-analysis.md.

import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
} from '@mdas/canonical';
import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { resolveGleanEnrichLimit } from '../../_shared/src/glean.js';
import { shouldSkipCerebroRestFetch } from './freshness.js';
import { CerebroRestClient } from './client.js';
import { readCerebroCredsFromEnv } from './config.js';
import { runCerebroConnectionTest } from './connection-test.js';
import { mapAccountDetailsItem } from './mapper.js';
import type { CerebroRestMappedRecord } from './mapper.js';
import { createCerebroRestStatsCollector } from './stats.js';

export const isReadOnly: true = true;

const DEFAULT_REST_CONCURRENCY = 4;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 10;

function resolveRestConcurrency(): number {
  const restOnly = Number(process.env.CEREBRO_REST_CONCURRENCY);
  if (Number.isFinite(restOnly) && restOnly > 0) return restOnly;
  const legacy = Number(process.env.CEREBRO_CONCURRENCY);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return DEFAULT_REST_CONCURRENCY;
}

function resolveBatchSize(): number {
  const n = Number(process.env.CEREBRO_BATCH_SIZE);
  if (Number.isFinite(n) && n > 0) return Math.min(MAX_BATCH_SIZE, Math.floor(n));
  return DEFAULT_BATCH_SIZE;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function hasAnyCerebroSignal(a: CanonicalAccount): boolean {
  if (a.cerebroRiskCategory) return true;
  const r = a.cerebroRisks;
  if (!r) return false;
  return Object.values(r).some((v) => v === true);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export const cerebroRestAdapter: ReadAdapter = {
  name: 'cerebro-rest',
  source: 'cerebro',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readCerebroCredsFromEnv();
    if (!creds) return { accounts: [], opportunities: [] };

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;
    const concurrency = resolveRestConcurrency();
    const batchSize = resolveBatchSize();

    let allAccounts: CanonicalAccount[];
    if (ctx?.priorRun) {
      allAccounts = ctx.priorRun.accounts;
    } else {
      const prior = await latestSuccessfulRun();
      if (!prior) {
        log?.info('cerebro-rest.skip', { reason: 'no prior snapshot' });
        return { accounts: [], opportunities: [] };
      }
      allAccounts = await readSnapshotAccounts(prior.id);
    }
    if (allAccounts.length === 0) {
      return { accounts: [], opportunities: [] };
    }

    const limit = resolveGleanEnrichLimit();
    const scoped =
      limit === 0
        ? allAccounts
        : [...allAccounts]
            .sort((a, b) => {
              const aHas = hasAnyCerebroSignal(a) ? 1 : 0;
              const bHas = hasAnyCerebroSignal(b) ? 1 : 0;
              if (aHas !== bHas) return aHas - bHas;
              return (b.allTimeARR ?? 0) - (a.allTimeARR ?? 0);
            })
            .slice(0, limit);

    const toFetch = scoped.filter((a) => !shouldSkipCerebroRestFetch(a));
    if (toFetch.length === 0) {
      log?.info('cerebro-rest.skip', {
        reason: 'all accounts within freshness window with Cerebro narrative',
      });
      return { accounts: [], opportunities: [] };
    }

    const stats = createCerebroRestStatsCollector();
    const client = new CerebroRestClient(creds, { stats });
    log?.info('cerebro-rest.start', {
      accountCount: toFetch.length,
      batchSize,
      batchCount: Math.ceil(toFetch.length / batchSize),
      concurrency,
      baseUrl: creds.baseUrl,
    });

    const startedAt = Date.now();
    let failures = 0;
    let processed = 0;
    const batches = chunk(toFetch, batchSize);
    const mappedRecords: Array<CerebroRestMappedRecord | null> = [];

    await mapWithConcurrency(batches, concurrency, async (batch) => {
      const ids = batch.map(
        (a) => a.salesforceAccountId || a.accountId,
      );
      try {
        const { data } = await client.postAccountDetails(ids);
        for (const item of data.items) {
          mappedRecords.push(mapAccountDetailsItem(item, { refreshAt }));
        }
        for (const account of batch) {
          ctx?.reportProgress?.(++processed, toFetch.length, account.accountName);
        }
      } catch (err) {
        failures += batch.length;
        log?.warn('cerebro-rest.batch.failed', {
          accountIds: ids,
          error: (err as Error).message,
        });
      }
    });

    const byAccount = new Map<string, CanonicalAccount>();
    for (const rec of mappedRecords) {
      if (!rec) continue;
      const existing = byAccount.get(rec.accountId);
      const partial: Partial<CanonicalAccount> = existing
        ? { ...existing, ...rec.patch }
        : rec.patch;
      byAccount.set(rec.accountId, {
        ...(partial as CanonicalAccount),
        accountId: rec.accountId,
      });
    }

    log?.info('cerebro-rest.complete', {
      mapped: byAccount.size,
      failures,
      skippedFresh: scoped.length - toFetch.length,
      batchCount: batches.length,
      durationMs: Date.now() - startedAt,
      http: stats.snapshot(),
    });

    return { accounts: Array.from(byAccount.values()), opportunities: [] };
  },

  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readCerebroCredsFromEnv();
    if (!creds) {
      return {
        ok: false,
        details:
          'CEREBRO_API_TOKEN not set — mint a token in Cerebro Engage → Settings → API Tokens (requires Cerebro Engage access)',
      };
    }
    try {
      const result = await runCerebroConnectionTest(creds);
      return { ok: result.ok, details: result.summary };
    } catch (err) {
      return { ok: false, details: (err as Error).message };
    }
  },
};

export default cerebroRestAdapter;

export { CerebroRestClient, readCerebroCredsFromEnv, runCerebroConnectionTest };
export { shouldRunCerebroGleanFallback } from './fallback.js';
export { mapCerebroHealthRecord, mapAccountDetailsItem } from './mapper.js';
export { mapCerebroCapabilities } from './capabilities.js';

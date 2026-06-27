import 'server-only';
import type { AccountView } from '@mdas/canonical';
import type {
  AccountPlanGenerationMode,
  CollectorInput,
  PersistedAccountPlan,
} from '@mdas/account-plan-engine';
import {
  ACCOUNT_PLAN_SCHEMA_VERSION,
  checkExpand3Eligibility,
  generateAccountPlan,
  runAllLocalCollectors,
} from '@mdas/account-plan-engine';
import {
  deleteAccountPlanById,
  getLatestAccountPlan,
  hasActiveAccountPlanRefresh,
  insertAccountPlan,
  setAccountPlanRefreshingLock,
  clearStaleRefreshingPlans,
} from '@mdas/db';
import { getAccount } from '@/lib/read-model';
import { fetchRemoteCollectorContext } from '@/lib/account-plan/remote-collectors';
import { logAccountPlanTelemetry } from '@/lib/account-plan/telemetry';

const inFlight = new Set<string>();

export class AccountPlanNotEligibleError extends Error {
  code: string;
  status = 403;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AccountPlanNotEligibleError';
    this.code = code;
  }
}

export class AccountPlanConcurrentError extends Error {
  code = 'concurrent_refresh';
  status = 409;

  constructor() {
    super('An account plan refresh is already in progress for this account');
    this.name = 'AccountPlanConcurrentError';
  }
}

function rowToPersisted(row: Awaited<ReturnType<typeof getLatestAccountPlan>>): PersistedAccountPlan | null {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name ?? undefined,
    franchise: 'Expand 3',
    status: row.status as PersistedAccountPlan['status'],
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by ?? undefined,
    generationMode: row.generation_mode as PersistedAccountPlan['generationMode'],
    sourceSnapshot: row.source_snapshot as PersistedAccountPlan['sourceSnapshot'],
    plan: row.plan as PersistedAccountPlan['plan'],
    errorMetadata: (row.error_metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPersistedAccountPlan(
  accountId: string,
): Promise<PersistedAccountPlan | null> {
  const row = await getLatestAccountPlan(accountId);
  return rowToPersisted(row);
}

export async function generatePersistedAccountPlan(opts: {
  accountId: string;
  generationMode: AccountPlanGenerationMode;
  generatedBy?: string;
  req?: Request;
  skipConcurrencyGuard?: boolean;
}): Promise<PersistedAccountPlan> {
  const started = Date.now();
  const view = await getAccount(opts.accountId);
  const eligibility = checkExpand3Eligibility(view);
  if (!eligibility.eligible || !view) {
    throw new AccountPlanNotEligibleError(
      eligibility.reason ?? 'Not eligible',
      eligibility.code ?? 'not_expand3',
    );
  }

  if (!opts.skipConcurrencyGuard) {
    await clearStaleRefreshingPlans();
    if (inFlight.has(opts.accountId) || (await hasActiveAccountPlanRefresh(opts.accountId))) {
      throw new AccountPlanConcurrentError();
    }
  }

  inFlight.add(opts.accountId);
  let lockId: string | null = null;

  try {
    lockId = await setAccountPlanRefreshingLock(
      opts.accountId,
      view.account.accountName,
      opts.generatedBy,
    );

    logAccountPlanTelemetry('account_plan.generation.started', {
      accountId: opts.accountId,
      mode: opts.generationMode,
    });

    const now = Date.now();
    const remote = await fetchRemoteCollectorContext(view, opts.req);
    const collectorInput: CollectorInput = {
      view,
      now,
      cerebroIntel: remote.cerebroIntel,
      gleanContext: remote.gleanContext,
      slackContext: remote.slackContext,
    };
    const collectorOutputs = runAllLocalCollectors(collectorInput);
    const plan = generateAccountPlan({
      view,
      collectorOutputs,
      now,
      generatedBy: opts.generatedBy,
      generationMode: opts.generationMode,
    });

    const sourceSnapshot = {
      collectedAt: new Date(now).toISOString(),
      collectors: collectorOutputs.map((c) => c.run),
      signalIds: plan.evidence.map((s) => s.id),
    };

    const planId = await insertAccountPlan({
      accountId: opts.accountId,
      accountName: view.account.accountName,
      status: 'generated',
      schemaVersion: ACCOUNT_PLAN_SCHEMA_VERSION,
      generatedAt: plan.generatedAt,
      generatedBy: opts.generatedBy,
      generationMode: opts.generationMode,
      sourceSnapshot,
      plan,
    });

    if (lockId) await deleteAccountPlanById(lockId);

    logAccountPlanTelemetry('account_plan.generation.succeeded', {
      accountId: opts.accountId,
      mode: opts.generationMode,
      durationMs: Date.now() - started,
      confidence: plan.summary.confidence,
      collectorFailures: plan.dataQuality.collectorFailures.length,
      warningCount:
        plan.dataQuality.missingSignals.length +
        plan.dataQuality.staleSignals.length +
        plan.dataQuality.conflictingSignals.length,
    });

    const persisted = await getPersistedAccountPlan(opts.accountId);
    if (!persisted || persisted.id !== planId) {
      return {
        id: planId,
        accountId: opts.accountId,
        accountName: view.account.accountName,
        franchise: 'Expand 3',
        status: 'generated',
        schemaVersion: ACCOUNT_PLAN_SCHEMA_VERSION,
        generatedAt: plan.generatedAt,
        generatedBy: opts.generatedBy,
        generationMode: opts.generationMode,
        sourceSnapshot,
        plan,
        createdAt: plan.generatedAt,
        updatedAt: plan.generatedAt,
      };
    }
    return persisted;
  } catch (err) {
    logAccountPlanTelemetry('account_plan.generation.failed', {
      accountId: opts.accountId,
      mode: opts.generationMode,
      durationMs: Date.now() - started,
      error: (err as Error).message,
    });
    if (lockId) await deleteAccountPlanById(lockId).catch(() => undefined);
    throw err;
  } finally {
    inFlight.delete(opts.accountId);
  }
}

export async function listEligibleExpand3AccountIds(): Promise<string[]> {
  const { getDashboardData } = await import('@/lib/read-model');
  const { views } = await getDashboardData();
  return views.map((v) => v.account.accountId);
}

/** Test-only */
export function __resetAccountPlanInFlightForTests(): void {
  inFlight.clear();
}

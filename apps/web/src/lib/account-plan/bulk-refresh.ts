import 'server-only';
import {
  completeAccountPlanBulkJob,
  countBulkJobItemsByStatus,
  findActiveAccountPlanBulkJob,
  getAccountPlanBulkJob,
  listPendingBulkJobItems,
  startAccountPlanBulkJob,
  updateAccountPlanBulkJobProgress,
  updateBulkJobItem,
} from '@mdas/db';
import {
  generatePersistedAccountPlan,
  listEligibleExpand3AccountIds,
} from '@/lib/account-plan/generate';
import { logAccountPlanTelemetry } from '@/lib/account-plan/telemetry';

const BATCH_SIZE = 5;
const CONCURRENCY = 2;

let drainRunning = false;

export async function enqueueExpand3BulkRefresh(requestedBy: string): Promise<string> {
  const active = await findActiveAccountPlanBulkJob();
  if (active) {
    kickBulkJobDrain(active.id);
    return active.id;
  }

  const accountIds = await listEligibleExpand3AccountIds();
  const { enqueueAccountPlanBulkJob } = await import('@mdas/db');
  const jobId = await enqueueAccountPlanBulkJob(accountIds, requestedBy);

  logAccountPlanTelemetry('account_plan.bulk.started', {
    jobId,
    total: accountIds.length,
  });

  kickBulkJobDrain(jobId);

  return jobId;
}

/** Resume or start draining a bulk job (idempotent when already running). */
export function kickBulkJobDrain(jobId: string): void {
  void drainBulkJob(jobId).catch((err) => {
    logAccountPlanTelemetry('account_plan.bulk.failed', {
      jobId,
      error: (err as Error).message,
    });
  });
}

async function drainBulkJob(jobId: string): Promise<void> {
  if (drainRunning) return;
  drainRunning = true;
  try {
    await startAccountPlanBulkJob(jobId);
    const job = await getAccountPlanBulkJob(jobId);
    if (!job) return;

    const total = Number((job.progress as { total?: number }).total ?? 0);
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    while (true) {
      const pending = await listPendingBulkJobItems(jobId, BATCH_SIZE);
      if (pending.length === 0) break;

      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const chunk = pending.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async ({ account_id: accountId }) => {
          try {
            const plan = await generatePersistedAccountPlan({
              accountId,
              generationMode: 'bulk_refresh',
              generatedBy: job.requested_by,
              skipConcurrencyGuard: true,
            });
            await updateBulkJobItem(jobId, accountId, {
              status: 'success',
              planId: plan.id,
            });
            completed += 1;
          } catch (err) {
            const message = (err as Error).message ?? 'failed';
            const isSkip = message.includes('Not eligible') || message.includes('not Expand 3');
            await updateBulkJobItem(jobId, accountId, {
              status: isSkip ? 'skipped' : 'failed',
              errorMessage: message,
            });
            if (isSkip) skipped += 1;
            else failed += 1;
          }

          await updateAccountPlanBulkJobProgress(jobId, {
            total,
            completed,
            failed,
            skipped,
            pct: total > 0 ? Math.round(((completed + failed + skipped) / total) * 100) : 100,
          });
          }),
        );
      }
    }

    const counts = await countBulkJobItemsByStatus(jobId);
    const finalStatus =
      (counts.failed ?? 0) > 0
        ? (counts.success ?? 0) > 0
          ? 'partial'
          : 'failed'
        : 'success';

    await completeAccountPlanBulkJob(jobId, finalStatus, {
      total,
      completed: counts.success ?? 0,
      failed: counts.failed ?? 0,
      skipped: counts.skipped ?? 0,
    });

    logAccountPlanTelemetry(
      finalStatus === 'success' ? 'account_plan.bulk.completed' : 'account_plan.bulk.partial_failed',
      { jobId, ...counts },
    );
  } catch (err) {
    const counts = await countBulkJobItemsByStatus(jobId).catch(() => ({}));
    await completeAccountPlanBulkJob(jobId, 'failed', {
      error: (err as Error).message,
      ...counts,
    }).catch(() => undefined);
    throw err;
  } finally {
    drainRunning = false;
  }
}

export async function getBulkRefreshStatus(jobId: string) {
  const job = await getAccountPlanBulkJob(jobId);
  if (!job) return null;
  const counts = await countBulkJobItemsByStatus(jobId);
  return {
    jobId: job.id,
    status: job.status,
    enqueuedAt: job.enqueued_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    progress: job.progress,
    result: job.result,
    counts,
  };
}

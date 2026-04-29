// Worker process: listens for `refresh` notifications and runs the refresh pipeline.
//
// Logging is JSON on stdout/stderr (PR-B4) so a downstream collector
// (e.g. CloudWatch or Loki) can index `refreshId`, `requestId`, `source`
// without parsing brackets out of free-form text.
import pg from 'pg';
import { claimNextJob, completeJob, audit } from '@mdas/db';
import { runRefresh, selectActiveAdapters } from './orchestrate.js';
import { log } from './logger.js';

const { Client } = pg;

/**
 * One-shot startup health probe across every adapter currently selected
 * by the env-flag matrix. Each adapter that implements `healthCheck()`
 * gets called once, with a 5s timeout, and the verdict is logged. The
 * worker does NOT exit on a failed probe — failures are advisory; the
 * refresh pipeline will surface them again per-account at run time. The
 * point is to fail fast and visibly at boot so a misconfigured token
 * doesn't silently waste 7 seconds per refresh forever.
 */
async function logAdapterHealth(): Promise<void> {
  const adapters = selectActiveAdapters();
  log.info('health.start', { adapterCount: adapters.length });
  await Promise.all(
    adapters.map(async (a) => {
      if (!a.healthCheck) {
        log.info('health.skipped', { adapter: a.name, reason: 'no probe defined' });
        return;
      }
      const t0 = Date.now();
      try {
        const result = await Promise.race([
          a.healthCheck(),
          new Promise<{ ok: false; details: string }>((_, rej) =>
            setTimeout(() => rej(new Error('timeout after 5s')), 5_000),
          ),
        ]);
        log.info('health.probe', {
          adapter: a.name,
          ok: result.ok,
          durationMs: Date.now() - t0,
          details: result.details,
        });
      } catch (err) {
        log.warn('health.probe', {
          adapter: a.name,
          ok: false,
          durationMs: Date.now() - t0,
          error: (err as Error).message,
        });
      }
    }),
  );
}

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL || 'postgres://mdas:mdas@localhost:5432/mdas';

  // 0) Probe each enabled adapter so misconfiguration is visible at boot,
  //    not buried inside the next refresh's per-account loop.
  await logAdapterHealth();

  // 1) Drain any queued jobs at startup.
  await drain();

  // 2) Open a dedicated LISTEN connection.
  const listener = new Client({ connectionString: url });
  await listener.connect();
  await listener.query('LISTEN refresh');
  listener.on('notification', (msg) => {
    if (msg.channel === 'refresh') {
      void drain();
    }
  });

  log.info('worker.listening', {});
  // Hold the process open.
  await new Promise<void>(() => undefined);
}

let draining = false;
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const job = await claimNextJob();
      if (!job) break;
      // PR-B4: thread the job id as the request-id so every log line
      // and audit row in the worker can be correlated to the originating
      // /api/refresh POST. The web app already returns jobId to the
      // browser, so the manager has the trace key in the URL/network log.
      const jobLog = log.child({ jobId: job.id, requestId: job.id });
      jobLog.info('job.start', {});
      try {
        const result = await runRefresh({ actor: 'worker', requestId: job.id });
        await completeJob(job.id, result.refreshId, 'success');
        jobLog.info('job.complete', {
          refreshId: result.refreshId,
          status: result.status,
          durationMs: result.durationMs,
        });
      } catch (err) {
        jobLog.error('job.failed', { error: (err as Error).message });
        await audit('worker', 'refresh.failed', {
          requestId: job.id,
          error: (err as Error).message,
        });
        // Mark job failed without a refresh id.
        try {
          await completeJob(job.id, '00000000-0000-0000-0000-000000000000', 'failed');
        } catch {
          /* swallow */
        }
      }
    }
  } finally {
    draining = false;
  }
}

main().catch((err) => {
  log.error('worker.fatal', { error: (err as Error).message });
  process.exit(1);
});

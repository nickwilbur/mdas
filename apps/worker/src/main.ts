// Worker process: listens for `refresh` notifications and runs the refresh pipeline.
import pg from 'pg';
import { claimNextJob, completeJob, audit } from '@mdas/db';
import { runRefresh, selectActiveAdapters } from './orchestrate.js';

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
  console.log(`[health] probing ${adapters.length} active adapter(s)`);
  await Promise.all(
    adapters.map(async (a) => {
      if (!a.healthCheck) {
        console.log(`[health] ${a.name.padEnd(18)} -        (no probe defined)`);
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
        const dur = `${Date.now() - t0}ms`.padStart(6);
        const mark = result.ok ? '\u2713' : '\u2717';
        console.log(
          `[health] ${a.name.padEnd(18)} ${mark} ${dur}  ${result.details}`,
        );
      } catch (err) {
        const dur = `${Date.now() - t0}ms`.padStart(6);
        console.log(
          `[health] ${a.name.padEnd(18)} \u2717 ${dur}  ${(err as Error).message}`,
        );
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

  console.log('[worker] listening for refresh notifications');
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
      console.log(`[worker] running job ${job.id}`);
      try {
        const result = await runRefresh({ actor: 'worker' });
        await completeJob(job.id, result.refreshId, 'success');
        console.log(`[worker] job ${job.id} → ${result.status}, ${result.durationMs}ms`);
      } catch (err) {
        console.error(`[worker] job ${job.id} failed`, err);
        await audit('worker', 'refresh.failed', { error: (err as Error).message });
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
  console.error(err);
  process.exit(1);
});

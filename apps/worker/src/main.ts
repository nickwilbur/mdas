// Worker process: listens for `refresh` notifications and runs the refresh pipeline.
import pg from 'pg';
import { claimNextJob, completeJob, audit } from '@mdas/db';
import { runRefresh } from './orchestrate.js';

const { Client } = pg;

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL || 'postgres://mdas:mdas@localhost:5432/mdas';

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

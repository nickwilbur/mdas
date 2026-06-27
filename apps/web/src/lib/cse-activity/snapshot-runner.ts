import 'server-only';
import { randomUUID } from 'node:crypto';
import { generateCseActivitySnapshot } from './service';
import {
  CSE_SNAPSHOT_JOB_MAX_CONCURRENT,
  countRunningCseSnapshotJobs,
  findActiveCseSnapshotJob,
  getCseSnapshotJob,
  listCseSnapshotJobsRecent,
  putCseSnapshotJob,
  type CseSnapshotJob,
} from './snapshot-jobs';

export async function runCseSnapshotJob(jobId: string, request?: Request): Promise<void> {
  const job = getCseSnapshotJob(jobId);
  if (!job || job.status !== 'running') return;

  const started = Date.now();
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'info',
      msg: 'cse_activity.snapshot.job.start',
      service: 'web',
      jobId,
    }),
  );

  try {
    const pkg = await generateCseActivitySnapshot({
      request,
      onProgress: (progress) => {
        job.progress = progress;
      },
    });

    job.status = 'done';
    job.result = {
      snapshotDate: pkg.snapshotDate,
      teamReportCount: pkg.teamReportNames.length,
      dir: pkg.dir,
    };
    job.progress = {
      phase: 'done',
      current: 1,
      total: 1,
      label: pkg.snapshotDate,
    };

    console.info(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        msg: 'cse_activity.snapshot.job.done',
        service: 'web',
        jobId,
        snapshotDate: pkg.snapshotDate,
        teamReports: pkg.teamReportNames.length,
        durationMs: Date.now() - started,
      }),
    );
  } catch (err) {
    job.status = 'error';
    job.error = (err as Error).message ?? 'Snapshot generation failed';
    console.error(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        msg: 'cse_activity.snapshot.job.error',
        service: 'web',
        jobId,
        error: job.error,
        durationMs: Date.now() - started,
      }),
    );
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

export function startCseSnapshotJob(request?: Request): CseSnapshotJob {
  if (countRunningCseSnapshotJobs() >= CSE_SNAPSHOT_JOB_MAX_CONCURRENT) {
    const active = findActiveCseSnapshotJob();
    if (active) return active;
    throw new Error('A snapshot is already running');
  }

  const job: CseSnapshotJob = {
    id: randomUUID(),
    status: 'running',
    progress: { phase: 'queued', current: 0, total: 1, label: 'Queued…' },
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  putCseSnapshotJob(job);

  void runCseSnapshotJob(job.id, request);

  return job;
}

export {
  findActiveCseSnapshotJob,
  getCseSnapshotJob,
  listCseSnapshotJobsRecent,
};

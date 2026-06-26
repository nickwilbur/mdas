import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  CTA_JOB_MAX_CONCURRENT,
  countRunningCtaJobs,
  findActiveCtaGenerationJob,
  getCtaJob,
  listCtaJobsSortedRecent,
  putCtaJob,
  registerCtaJobChild,
  type CTAJob,
} from '@/lib/cta-generation-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bound stderr accumulation from the child process (per job). */
const MAX_STDERR_CAPTURE_CHARS = 64 * 1024;

export async function POST(): Promise<Response> {
  if (countRunningCtaJobs() >= CTA_JOB_MAX_CONCURRENT) {
    return NextResponse.json(
      {
        error: `At most ${CTA_JOB_MAX_CONCURRENT} CTA generations can run at once`,
        code: 'too-many-running',
      },
      { status: 429 },
    );
  }

  const jobId = randomUUID();
  const job: CTAJob = {
    id: jobId,
    status: 'running',
    progress: null,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  putCtaJob(job);

  // Spawn the generation script as a child process.
  // Next.js cwd is apps/web; project root is 2 levels up.
  // Also check for monorepo root markers to be safe.
  let projectRoot = resolve(process.cwd(), '../..');
  if (!existsSync(resolve(projectRoot, 'scripts/generate-ctas.ts'))) {
    // Fallback: try from process.cwd() directly (in case cwd IS the root).
    if (existsSync(resolve(process.cwd(), 'scripts/generate-ctas.ts'))) {
      projectRoot = process.cwd();
    }
  }

  const child = spawn('npx', ['tsx', 'scripts/generate-ctas.ts'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';

  const onStdout = (data: Buffer): void => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          job.progress = {
            phase: event.phase,
            current: event.current,
            total: event.total,
            ...(event.label ? { label: event.label } : {}),
          };
        } else if (event.type === 'result') {
          job.result = {
            scanDate: event.scanDate,
            ctaCount: event.ctaCount,
            scanFilePath: event.scanFilePath,
            logFilePath: event.logFilePath,
          };
        }
      } catch {
        // Non-JSON stdout line, ignore
      }
    }
  };

  const onStderr = (data: Buffer): void => {
    stderr = (stderr + data.toString()).slice(-MAX_STDERR_CAPTURE_CHARS);
  };

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  child.on('close', (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = 'done';
    } else {
      job.status = 'error';
      job.error = stderr || `Process exited with code ${code}`;
    }
    console.info(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        msg: 'cta.job.closed',
        service: 'web',
        jobId,
        status: job.status,
        exitCode: code,
      }),
    );
  });

  child.on('error', (err) => {
    job.finishedAt = new Date().toISOString();
    job.status = 'error';
    job.error = err.message || 'Failed to spawn generation process';
    console.error(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        msg: 'cta.job.spawn_error',
        service: 'web',
        jobId,
        error: job.error,
      }),
    );
  });

  registerCtaJobChild(jobId, child);

  return NextResponse.json({ jobId });
}

// GET: active job for resume, full status via ?jobId=, or recent job list
export async function GET(req: Request): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get('jobId');
  const headers = { 'Cache-Control': 'no-store' };

  if (jobId) {
    const job = getCtaJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'not found' }, { status: 404, headers });
    }
    return NextResponse.json(job, { headers });
  }

  const active = findActiveCtaGenerationJob();
  const list = listCtaJobsSortedRecent(10);
  return NextResponse.json(
    {
      jobId: active?.id ?? null,
      status: active?.status ?? null,
      jobs: list,
    },
    { headers },
  );
}

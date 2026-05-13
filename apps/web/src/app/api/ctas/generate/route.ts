import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  listCtaJobsSortedRecent,
  putCtaJob,
  type CTAJob,
} from '@/lib/cta-generation-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bound stderr accumulation from the child process (per job). */
const MAX_STDERR_CAPTURE_CHARS = 64 * 1024;

export async function POST(): Promise<Response> {
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
  try {
    const { existsSync } = require('fs');
    if (!existsSync(resolve(projectRoot, 'scripts/generate-ctas.ts'))) {
      // Fallback: try from process.cwd() directly (in case cwd IS the root)
      if (existsSync(resolve(process.cwd(), 'scripts/generate-ctas.ts'))) {
        projectRoot = process.cwd();
      }
    }
  } catch { /* proceed with default */ }

  const child = spawn('npx', ['tsx', 'scripts/generate-ctas.ts'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';

  child.stdout.on('data', (data: Buffer) => {
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
  });

  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-MAX_STDERR_CAPTURE_CHARS);
  });

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

  return NextResponse.json({ jobId });
}

// GET: list active/recent jobs
export async function GET(): Promise<Response> {
  const list = listCtaJobsSortedRecent(10);
  return NextResponse.json({ jobs: list });
}

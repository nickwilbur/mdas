import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory job store (sufficient for single-user local tool)
interface CTAJob {
  id: string;
  status: 'running' | 'done' | 'error';
  progress: { phase: string; current: number; total: number; label?: string } | null;
  result: { scanDate: string; ctaCount: number; scanFilePath: string; logFilePath: string } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// Global job map — survives across requests within the same server process
const jobs = new Map<string, CTAJob>();

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
  jobs.set(jobId, job);

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
    stderr += data.toString();
  });

  child.on('close', (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = 'done';
    } else {
      job.status = 'error';
      job.error = stderr || `Process exited with code ${code}`;
    }
  });

  return NextResponse.json({ jobId });
}

// GET: list active/recent jobs
export async function GET(): Promise<Response> {
  const list = Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10);
  return NextResponse.json({ jobs: list });
}

// Export jobs map for the [jobId] route to read
export { jobs };

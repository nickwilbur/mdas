#!/usr/bin/env node
// Seed: produces two refresh runs against mocks (prior + current) so /wow has data.
// Uses tsx via dynamic import.
import { spawn } from 'node:child_process';

function runScript(file, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx', file], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

await runScript('apps/worker/src/seed-prior.ts');
await runScript('apps/worker/src/refresh-once.ts');
console.log('[seed] done. Two refresh runs present (prior + current).');

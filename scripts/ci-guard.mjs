#!/usr/bin/env node
// CI guardrails for MDAS read-only enforcement.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = false;
function fail(msg) { console.error(`[ci-guard] FAIL: ${msg}`); failed = true; }
function ok(msg) { console.log(`[ci-guard] OK: ${msg}`); }

// 1) src/adapters/write/ must not exist anywhere.
function walk(dir, hits) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry.startsWith('.git')) continue;
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (p.endsWith('/adapters/write') || p.endsWith('\\adapters\\write')) hits.push(p);
      walk(p, hits);
    }
  }
}
const writeHits = [];
walk(process.cwd(), writeHits);
if (writeHits.length) fail(`Forbidden adapters/write directory present: ${writeHits.join(', ')}`);
else ok('No adapters/write directory present.');

// 2) mcp.config.json: no write-capable tool names.
const mcpPath = join(process.cwd(), 'mcp.config.json');
if (!existsSync(mcpPath)) fail('mcp.config.json missing');
else {
  const cfg = JSON.parse(readFileSync(mcpPath, 'utf8'));
  const writeRe = /^(create|update|cancel|delete|post|send)_/i;
  for (const [name, server] of Object.entries(cfg.servers ?? {})) {
    for (const tool of server.allowedTools ?? []) {
      if (writeRe.test(tool)) fail(`Server '${name}' allows write-capable tool '${tool}'`);
    }
  }
  ok('mcp.config.json contains no write-capable tool names.');
}

// 3) Every read adapter must export `isReadOnly: true`.
const readRoot = join(process.cwd(), 'packages/adapters/read');
if (existsSync(readRoot)) {
  for (const a of readdirSync(readRoot)) {
    if (a.startsWith('_')) continue; // shared utilities, not adapters
    const idx = join(readRoot, a, 'src/index.ts');
    if (!existsSync(idx)) { fail(`Adapter ${a} missing src/index.ts`); continue; }
    const src = readFileSync(idx, 'utf8');
    if (!/export\s+const\s+isReadOnly\s*(:\s*true)?\s*=\s*true/.test(src)) {
      fail(`Adapter ${a} does not export isReadOnly: true`);
    }
  }
  ok('All read adapters export isReadOnly: true.');
}

if (failed) process.exit(1);
console.log('[ci-guard] All checks passed.');

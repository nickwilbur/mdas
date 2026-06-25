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

// 4) Adapter source must not call any write verb on a known SDK / CLI.
// The patterns below match common write APIs:
//   - jsforce: connection.create / .update / .upsert / .delete / .destroy
//   - sf CLI: sf data create / update / upsert / delete / import
//   - REST: composite/sobjects POST/PATCH/DELETE-shaped paths
//   - Glean: any glean_* tool with a write verb prefix (none exist today)
// To intentionally bypass on a single line, append `// ci-guard:allow`.
//
// We deliberately use substring checks (not AST) — false positives are rare
// and a comment escape covers the legitimate edge case of mentioning a verb
// in a code comment for documentation. Keep these patterns tight.
const WRITE_PATTERNS = [
  // jsforce / Node Salesforce SDKs (method calls on a connection or sobject)
  /\b(?:connection|conn|sobject\([^)]*\)|sf|client)\s*\.\s*(create|update|upsert|destroy|delete)\s*\(/,
  // sf CLI invocations
  /\bsf\s+data\s+(create|update|upsert|delete|import)\b/,
  // Salesforce REST methods that mutate (POST/PATCH/DELETE to /sobjects/ or composite)
  /method\s*:\s*['"`](POST|PATCH|DELETE)['"`][^]*?\/(sobjects|composite)\b/i,
  // Future-proof Glean MCP write tools (none today). Match snake_case create/update/delete/post/send tools.
  /\bglean_(create|update|delete|post|send|upsert)_/,
];

function* walkFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry.startsWith('.git')) continue;
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      yield* walkFiles(p);
    } else if (p.endsWith('.ts') || p.endsWith('.js')) {
      yield p;
    }
  }
}

const adapterRoot = join(process.cwd(), 'packages/adapters');
let writeVerbHits = 0;
for (const file of walkFiles(adapterRoot)) {
  // Skip declaration files and the mock package (retired but still on disk).
  if (file.endsWith('.d.ts')) continue;
  if (file.includes('/adapters/mock/')) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('ci-guard:allow')) continue;
    for (const re of WRITE_PATTERNS) {
      if (re.test(line)) {
        fail(`Write-verb match in ${file}:${i + 1} — ${line.trim()}`);
        writeVerbHits++;
        break;
      }
    }
  }
}
if (writeVerbHits === 0) ok('No write verbs detected in adapter source.');

// 5) No stale tsc artifacts in package/app src trees — Node ESM can
// prefer these over .ts and break worker startup (missing named exports).
function findStaleJs(dir, hits) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) findStaleJs(p, hits);
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js') && !entry.endsWith('.config.js')) hits.push(p);
  }
}
const staleJs = [];
for (const root of ['packages', 'apps']) {
  const base = join(process.cwd(), root);
  if (!existsSync(base)) continue;
  for (const pkg of readdirSync(base)) {
    const src = join(base, pkg, 'src');
    findStaleJs(src, staleJs);
  }
}
if (staleJs.length) {
  fail(`Stale compiled .js files shadow TypeScript sources (delete them): ${staleJs.slice(0, 5).join(', ')}${staleJs.length > 5 ? ` (+${staleJs.length - 5} more)` : ''}`);
} else ok('No stale compiled .js artifacts in package/app src trees.');

// 6) apps/web must transpile every @mdas package it imports or depends on.
function collectWebMdasImports() {
  const webSrc = join(process.cwd(), 'apps/web/src');
  const imports = new Set();
  const re = /from\s+['"]@mdas\/([^'"]+)['"]/g;
  for (const file of walkFiles(webSrc)) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(re)) {
      const spec = match[1];
      const root = spec.startsWith('adapter-shared/') ? 'adapter-shared' : spec.split('/')[0];
      imports.add(`@mdas/${root}`);
    }
  }
  return imports;
}
const webPkgPath = join(process.cwd(), 'apps/web/package.json');
const webNextPath = join(process.cwd(), 'apps/web/next.config.mjs');
if (!existsSync(webPkgPath) || !existsSync(webNextPath)) {
  fail('apps/web package.json or next.config.mjs missing');
} else {
  const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
  const webDeps = Object.keys(webPkg.dependencies ?? {}).filter((name) => name.startsWith('@mdas/'));
  const webImports = collectWebMdasImports();
  const required = new Set([...webDeps, ...webImports]);
  const nextSrc = readFileSync(webNextPath, 'utf8');
  const transpileMatch = nextSrc.match(/transpilePackages:\s*\[([\s\S]*?)\]/);
  if (!transpileMatch) fail('apps/web/next.config.mjs missing transpilePackages');
  else {
    const transpiled = new Set([...transpileMatch[1].matchAll(/'(@mdas\/[^']+)'/g)].map((m) => m[1]));
    const missing = [...required].filter((pkg) => !transpiled.has(pkg));
    if (missing.length) {
      fail(`apps/web/next.config.mjs transpilePackages missing: ${missing.join(', ')}`);
    } else ok('apps/web transpilePackages covers all @mdas imports and dependencies.');
  }
}

if (failed) process.exit(1);
console.log('[ci-guard] All checks passed.');

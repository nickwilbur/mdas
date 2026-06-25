import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const WEB_SRC = join(ROOT, 'apps/web/src');
const WEB_NEXT_CONFIG = join(ROOT, 'apps/web/next.config.mjs');
const WEB_PACKAGE_JSON = join(ROOT, 'apps/web/package.json');

function* walkTsFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) yield* walkTsFiles(path);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) yield path;
  }
}

function collectMdasImports(): Set<string> {
  const imports = new Set<string>();
  const re = /from\s+['"]@mdas\/([^'"]+)['"]/g;
  for (const file of walkTsFiles(WEB_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(re)) {
      const spec = match[1]!;
      const root = spec.startsWith('adapter-shared/') ? 'adapter-shared' : spec.split('/')[0]!;
      imports.add(`@mdas/${root}`);
    }
  }
  return imports;
}

function readTranspilePackages(): Set<string> {
  const src = readFileSync(WEB_NEXT_CONFIG, 'utf8');
  const match = src.match(/transpilePackages:\s*\[([\s\S]*?)\]/);
  expect(match, 'next.config.mjs must declare transpilePackages').toBeTruthy();
  const pkgs = [...match![1]!.matchAll(/'(@mdas\/[^']+)'/g)].map((m) => m[1]!);
  return new Set(pkgs);
}

function readWebDependencies(): Set<string> {
  const pkg = JSON.parse(readFileSync(WEB_PACKAGE_JSON, 'utf8'));
  return new Set(
    Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@mdas/')),
  );
}

describe('apps/web monorepo package wiring', () => {
  it('transpiles every @mdas workspace dependency and import', () => {
    const imports = collectMdasImports();
    const transpiled = readTranspilePackages();
    const deps = readWebDependencies();
    const required = new Set([...imports, ...deps]);
    const missing = [...required].filter((pkg) => !transpiled.has(pkg));
    expect(missing, `add to apps/web/next.config.mjs transpilePackages: ${missing.join(', ')}`).toEqual(
      [],
    );
  });
});

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve monorepo root from Next.js cwd (`apps/web`) or repo-root dev. */
export function mdasProjectRoot(): string {
  if (process.env.MDAS_PROJECT_ROOT) {
    return process.env.MDAS_PROJECT_ROOT;
  }

  const markers = ['expand3_cta_log.jsonl', 'config/cse-activity.json', 'docs/leadership'];

  function hasMarker(root: string): boolean {
    return markers.some((m) => existsSync(resolve(root, m)));
  }

  const candidates = [
    process.cwd(),
    resolve(process.cwd(), '../..'),
    resolve(process.cwd(), '..'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'),
  ];

  for (const root of candidates) {
    if (hasMarker(root)) return root;
  }

  return resolve(process.cwd(), '../..');
}

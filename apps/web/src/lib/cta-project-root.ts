import { existsSync } from 'fs';
import { resolve } from 'path';

/** Resolve monorepo root from Next.js cwd (apps/web). */
export function ctaProjectRoot(): string {
  let root = resolve(process.cwd(), '../..');
  if (!existsSync(resolve(root, 'expand3_cta_log.jsonl'))) {
    if (existsSync(resolve(process.cwd(), 'expand3_cta_log.jsonl'))) {
      root = process.cwd();
    }
  }
  return root;
}

export function ctaLogPath(): string {
  if (process.env.MDAS_CTA_LOG_PATH) {
    return process.env.MDAS_CTA_LOG_PATH;
  }
  return resolve(ctaProjectRoot(), 'expand3_cta_log.jsonl');
}

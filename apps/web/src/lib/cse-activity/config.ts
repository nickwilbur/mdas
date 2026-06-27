import 'server-only';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeConfig,
  type CseActivityConfig,
  DEFAULT_CSE_ACTIVITY_CONFIG,
} from '@mdas/cse-activity';
import { mdasProjectRoot } from './project-root';

export function cseActivityConfigPath(): string {
  return join(mdasProjectRoot(), 'config/cse-activity.json');
}

export function loadCseActivityConfig(): CseActivityConfig {
  const path = cseActivityConfigPath();
  if (!existsSync(path)) return DEFAULT_CSE_ACTIVITY_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CseActivityConfig>;
    return mergeConfig(raw);
  } catch {
    return DEFAULT_CSE_ACTIVITY_CONFIG;
  }
}

export function saveCseActivityConfig(config: Partial<CseActivityConfig>): void {
  const path = cseActivityConfigPath();
  mkdirSync(join(path, '..'), { recursive: true });
  const merged = mergeConfig(config);
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

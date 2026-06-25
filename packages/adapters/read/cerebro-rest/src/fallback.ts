// Whether cerebro-glean (Glean MCP fallback) should run during refresh.

import { readCerebroCredsFromEnv } from './config.js';

/**
 * Default: run Glean fallback only when REST credentials are absent.
 * Override with CEREBRO_GLEAN_FALLBACK=1|0|true|false.
 */
export function shouldRunCerebroGleanFallback(): boolean {
  const raw = (process.env.CEREBRO_GLEAN_FALLBACK ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return readCerebroCredsFromEnv() === null;
}

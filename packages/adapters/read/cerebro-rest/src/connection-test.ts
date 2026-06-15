// Structured Cerebro connection diagnostics for healthCheck / admin tooling.

import { CerebroRestClient } from './client.js';
import type { CerebroRestCredentials } from './config.js';
import { mapCerebroCapabilities } from './capabilities.js';

export interface CerebroConnectionDiagnostic {
  step: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
}

export interface CerebroConnectionTestResult {
  ok: boolean;
  summary: string;
  diagnostics: CerebroConnectionDiagnostic[];
  capabilities: ReturnType<typeof mapCerebroCapabilities>;
}

export async function runCerebroConnectionTest(
  creds: CerebroRestCredentials,
  client?: CerebroRestClient,
): Promise<CerebroConnectionTestResult> {
  const c = client ?? new CerebroRestClient(creds);
  const diagnostics: CerebroConnectionDiagnostic[] = [];

  // Base URL reachability (unauthenticated may 401 — that still proves reachability)
  try {
    const started = Date.now();
    const resp = await fetch(`${creds.baseUrl}/api/whoami`, { method: 'HEAD' });
    diagnostics.push({
      step: 'base_url_reachable',
      ok: resp.status < 500,
      detail: `HTTP ${resp.status} from ${creds.baseUrl}`,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    diagnostics.push({
      step: 'base_url_reachable',
      ok: false,
      detail: `Network error — check VPN/Zscaler/corp access: ${(err as Error).message}`,
    });
  }

  let whoamiOk = false;
  try {
    const { data, meta } = await c.whoami();
    whoamiOk = Boolean(data.email ?? data.clientId);
    diagnostics.push({
      step: 'auth_valid',
      ok: whoamiOk,
      detail: whoamiOk
        ? `Authenticated as ${data.email ?? 'unknown'} (clientId=${data.clientId ?? 'n/a'})`
        : 'Unexpected whoami shape',
      durationMs: meta.durationMs,
    });
  } catch (err) {
    diagnostics.push({
      step: 'auth_valid',
      ok: false,
      detail: (err as Error).message,
    });
  }

  let guideOk = false;
  let apiGuide;
  try {
    const { data, meta } = await c.fetchApiGuide();
    apiGuide = data;
    guideOk = Boolean(data.guide);
    diagnostics.push({
      step: 'schema_discovery',
      ok: guideOk,
      detail: guideOk
        ? 'REST guide fetched from /api/guide/api'
        : 'Guide response missing `guide` field',
      durationMs: meta.durationMs,
    });
  } catch (err) {
    diagnostics.push({
      step: 'schema_discovery',
      ok: false,
      detail: (err as Error).message,
    });
  }

  if (whoamiOk) {
    try {
      const { data, meta } = await c.postAccountDetails(['001000000000000AAA']);
      const ok = Array.isArray(data.items) && Array.isArray(data.notFound);
      diagnostics.push({
        step: 'health_probe',
        ok,
        detail: ok
          ? `Account details endpoint reachable (${data.items.length} resolved, ${data.notFound.length} not found for probe batch)`
          : 'Unexpected account details response shape',
        durationMs: meta.durationMs,
      });
    } catch (err) {
      diagnostics.push({
        step: 'health_probe',
        ok: false,
        detail: (err as Error).message,
      });
    }
  }

  const capabilities = mapCerebroCapabilities(apiGuide);
  const ok = diagnostics.every((d) => d.ok || d.step === 'health_probe');
  const summary = ok
    ? `Cerebro REST connected (${creds.baseUrl}); ${capabilities.length} capabilities mapped`
    : diagnostics.find((d) => !d.ok)?.detail ?? 'Cerebro connection test failed';

  return { ok, summary, diagnostics, capabilities };
}

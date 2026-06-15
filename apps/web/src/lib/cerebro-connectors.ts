// Server-side Cerebro connector posture for /admin/data-quality and
// GET /api/cerebro/connectors. Never logs or returns token values.

import { readCerebroCredsFromEnv, runCerebroConnectionTest } from '@mdas/adapter-cerebro-rest';
import { readGleanCredsFromEnv, GleanClient } from '@mdas/adapter-shared/glean';

export type ConnectorState = 'ready' | 'misconfigured' | 'disabled' | 'error';

export interface CerebroConnectorStatus {
  id: 'cerebro-engage-rest' | 'cerebro-health-glean';
  product: 'Cerebro Engage' | 'Cerebro';
  transport: string;
  role: string;
  adapterEnabled: boolean;
  envConfigured: boolean;
  state: ConnectorState;
  ok: boolean;
  summary: string;
  details: string[];
  configureHint: string;
}

function adapterCerebroEnabled(): boolean {
  return (process.env.ADAPTER_CEREBRO ?? '').toLowerCase() === 'real';
}

function lines(...parts: Array<string | undefined>): string[] {
  return parts.filter((p): p is string => !!p);
}

/** Live probe: Cerebro Engage REST (direct API token). */
export async function probeCerebroEngageRest(): Promise<CerebroConnectorStatus> {
  const adapterEnabled = adapterCerebroEnabled();
  const creds = readCerebroCredsFromEnv();
  const envConfigured = creds !== null;

  const base: Omit<CerebroConnectorStatus, 'state' | 'ok' | 'summary' | 'details'> = {
    id: 'cerebro-engage-rest',
    product: 'Cerebro Engage',
    transport: 'REST (Cerebro Engage API token)',
    role:
      'Direct API — health risk, Risk Category, Risk Analysis, future Engage signals (catalysts)',
    adapterEnabled,
    envConfigured,
    configureHint:
      'Set ADAPTER_CEREBRO=real, CEREBRO_API_TOKEN (Cerebro Engage → Settings → API Tokens), and CEREBRO_BASE_URL=https://cerebro-mcp.corpdata.zuora.com in .env. Requires Cerebro Engage access (VPN + AMG-Zscaler-Cerebro).',
  };

  if (!adapterEnabled) {
    return {
      ...base,
      state: 'disabled',
      ok: false,
      summary: 'Adapter disabled (ADAPTER_CEREBRO≠real)',
      details: lines('Worker will not call Cerebro Engage REST until ADAPTER_CEREBRO=real.'),
    };
  }
  if (!envConfigured) {
    return {
      ...base,
      state: 'misconfigured',
      ok: false,
      summary: 'CEREBRO_API_TOKEN not set',
      details: lines(
        'Mint a long-lived token in Cerebro Engage → Settings → API Tokens.',
        'Glean fallback may still populate cerebroRisks booleans without Risk Category.',
      ),
    };
  }

  try {
    const result = await runCerebroConnectionTest(creds);
    return {
      ...base,
      state: result.ok ? 'ready' : 'error',
      ok: result.ok,
      summary: result.summary,
      details: result.diagnostics.map((d) => `${d.step}: ${d.detail}`),
    };
  } catch (err) {
    return {
      ...base,
      state: 'error',
      ok: false,
      summary: (err as Error).message,
      details: [],
    };
  }
}

/** Live probe: Cerebro health-risk via Glean index (not Cerebro Engage). */
export async function probeCerebroHealthGlean(): Promise<CerebroConnectorStatus> {
  const adapterEnabled = adapterCerebroEnabled();
  const creds = readGleanCredsFromEnv();
  const envConfigured = creds !== null;

  const base: Omit<CerebroConnectorStatus, 'state' | 'ok' | 'summary' | 'details'> = {
    id: 'cerebro-health-glean',
    product: 'Cerebro',
    transport: 'Glean MCP (app:cerebro / type:healthrisk)',
    role:
      'Federated index — 7 risk booleans + sub-metrics. Does NOT expose Risk Category or Risk Analysis.',
    adapterEnabled,
    envConfigured,
    configureHint:
      'Set ADAPTER_CEREBRO=real, GLEAN_MCP_TOKEN, and GLEAN_MCP_BASE_URL in .env (same Glean token as other adapters).',
  };

  if (!adapterEnabled) {
    return {
      ...base,
      state: 'disabled',
      ok: false,
      summary: 'Adapter disabled (ADAPTER_CEREBRO≠real)',
      details: [],
    };
  }
  if (!envConfigured) {
    return {
      ...base,
      state: 'misconfigured',
      ok: false,
      summary: 'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set',
      details: [],
    };
  }

  try {
    const client = new GleanClient(creds);
    const health = await client.healthCheck();
    let cerebroHit = false;
    if (health.ok) {
      try {
        const search = await client.search({ query: 'cerebro healthrisk', pageSize: 3 });
        const docs = search.documents ?? search.results ?? [];
        cerebroHit = docs.some(
          (d) =>
            d.datasource === 'cerebro' ||
            d.matchingFilters?.app?.includes('cerebro') === true,
        );
      } catch {
        /* search failure surfaced below */
      }
    }
    const detailLines = lines(
      health.details,
      health.ok
        ? cerebroHit
          ? 'Cerebro datasource reachable via Glean search.'
          : 'Glean OK but no cerebro healthrisk docs in sample search — check index permissions.'
        : undefined,
    );
    return {
      ...base,
      state: health.ok ? 'ready' : 'error',
      ok: health.ok,
      summary: health.ok
        ? cerebroHit
          ? 'Glean MCP connected; Cerebro index responding'
          : 'Glean MCP connected; Cerebro index not confirmed'
        : health.details,
      details: detailLines,
    };
  } catch (err) {
    return {
      ...base,
      state: 'error',
      ok: false,
      summary: (err as Error).message,
      details: [],
    };
  }
}

export async function getCerebroConnectorStatuses(): Promise<CerebroConnectorStatus[]> {
  const [engage, glean] = await Promise.all([
    probeCerebroEngageRest(),
    probeCerebroHealthGlean(),
  ]);
  return [engage, glean];
}

export interface CerebroSnapshotQuality {
  withRiskCategory: number;
  withRiskCategoryARR: number;
  withBooleansOnly: number;
  withBooleansOnlyARR: number;
  withNeither: number;
  withNeitherARR: number;
  total: number;
}

/** Snapshot-derived split: Engage-only fields vs Glean-only enrichment. */
export function summarizeCerebroSnapshotQuality(
  accounts: Array<{
    allTimeARR: number | null;
    cerebroRiskCategory: string | null;
    cerebroRisks?: Record<string, boolean | null> | null;
    lastFetchedFromSource?: Partial<Record<string, string>>;
  }>,
): CerebroSnapshotQuality {
  let withRiskCategory = 0;
  let withRiskCategoryARR = 0;
  let withBooleansOnly = 0;
  let withBooleansOnlyARR = 0;
  let withNeither = 0;
  let withNeitherARR = 0;

  for (const a of accounts) {
    const arr = a.allTimeARR ?? 0;
    const hasCategory = !!a.cerebroRiskCategory;
    const hasBool =
      a.cerebroRisks &&
      Object.values(a.cerebroRisks).some((v) => v === true || v === false);
    const touched = !!a.lastFetchedFromSource?.cerebro;

    if (hasCategory) {
      withRiskCategory += 1;
      withRiskCategoryARR += arr;
    } else if (hasBool || touched) {
      withBooleansOnly += 1;
      withBooleansOnlyARR += arr;
    } else {
      withNeither += 1;
      withNeitherARR += arr;
    }
  }

  return {
    withRiskCategory,
    withRiskCategoryARR,
    withBooleansOnly,
    withBooleansOnlyARR,
    withNeither,
    withNeitherARR,
    total: accounts.length,
  };
}

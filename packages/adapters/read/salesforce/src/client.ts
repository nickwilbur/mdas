// SalesforceClient — read-only REST/Bulk wrapper using native fetch().
//
// Read-only by construction:
//   - Only exposes query (REST) and bulkQuery (REST auto-pagination) methods.
//   - No create / update / upsert / destroy / delete methods are exported.
//   - The CI guard (scripts/ci-guard.mjs) greps adapter source for write
//     verbs as a defense-in-depth check.
//
// Auth model: OAuth refresh-token grant. The refresh token is stored as a
// secret (env or Docker secret) and exchanged for an access token on first
// use. Access tokens are cached in-memory for their lifetime; on 401 we
// transparently refresh once and retry.
//
// HTTP uses Node's native fetch(), not jsforce's node-fetch transport.
// Behind corporate TLS inspection (Zscaler), jsforce hangs on instance-URL
// calls even when login.salesforce.com OAuth succeeds. Native fetch respects
// NODE_EXTRA_CA_CERTS when .docker-ca.pem is mounted (see README.md).
export interface SalesforceCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** e.g., https://zuora.my.salesforce.com */
  instanceUrl: string;
  /** Optional: pin a Salesforce REST API version. Defaults to 59.0. */
  apiVersion?: string;
  /** Optional: override the OAuth token endpoint base URL.
   *  Defaults to https://login.salesforce.com when unset. */
  loginUrl?: string;
}

export interface SalesforceQueryRecord {
  Id: string;
  [field: string]: unknown;
}

interface OAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface QueryResultPage<T> {
  records: T[];
  done: boolean;
  nextRecordsUrl?: string;
  totalSize: number;
}

/** Exchange a refresh token via the standard Salesforce OAuth endpoint. */
async function refreshAccessToken(creds: SalesforceCredentials): Promise<string> {
  const loginUrl = (creds.loginUrl ?? 'https://login.salesforce.com').replace(/\/$/, '');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: creds.clientId,
    refresh_token: creds.refreshToken,
  });
  if (creds.clientSecret) body.set('client_secret', creds.clientSecret);

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as OAuthTokenResponse;
  if (!res.ok || !json.access_token) {
    const detail = [json.error, json.error_description].filter(Boolean).join(': ');
    throw new Error(
      `Salesforce OAuth refresh failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  return json.access_token;
}

export class SalesforceClient {
  private accessToken: string | null = null;
  /** Deduplicates parallel ensureAccessToken() calls. */
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly creds: SalesforceCredentials) {}

  private apiVersion(): string {
    return this.creds.apiVersion ?? '59.0';
  }

  private instanceBase(): string {
    return this.creds.instanceUrl.replace(/\/$/, '');
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!this.tokenPromise) {
      this.tokenPromise = refreshAccessToken(this.creds)
        .then((token) => {
          this.accessToken = token;
          return token;
        })
        .finally(() => {
          this.tokenPromise = null;
        });
    }
    return this.tokenPromise;
  }

  /** Authenticated fetch against the org instance URL. Retries once on 401. */
  private async apiFetch(path: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
    const token = await this.ensureAccessToken();
    const url = path.startsWith('http') ? path : `${this.instanceBase()}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...init.headers,
      },
    });
    if (res.status === 401 && allowRetry) {
      this.accessToken = null;
      await this.ensureAccessToken();
      return this.apiFetch(path, init, false);
    }
    return res;
  }

  private async readJson<T>(res: Response, label: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Salesforce ${label} failed (HTTP ${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    return JSON.parse(text) as T;
  }

  /**
   * Run a SOQL query via the REST API with auto-pagination.
   */
  async query<T extends SalesforceQueryRecord = SalesforceQueryRecord>(
    soql: string,
  ): Promise<T[]> {
    const out: T[] = [];
    let path =
      `/services/data/v${this.apiVersion()}/query?q=${encodeURIComponent(soql)}`;
    for (;;) {
      const page = await this.readJson<QueryResultPage<T>>(
        await this.apiFetch(path),
        'query',
      );
      out.push(...page.records);
      if (page.done || !page.nextRecordsUrl) break;
      path = page.nextRecordsUrl;
    }
    return out;
  }

  /**
   * Large SOQL pulls. Uses REST auto-pagination (reliable behind corp TLS).
   * Expand 3 opps (~3k rows) typically completes in a few paginated calls.
   */
  async bulkQuery<T extends SalesforceQueryRecord = SalesforceQueryRecord>(
    soql: string,
  ): Promise<T[]> {
    return this.query<T>(soql);
  }

  /**
   * Health check — verifies token exchange and a trivial SELECT.
   */
  async healthCheck(): Promise<{ ok: boolean; details: string }> {
    const loginUrl = this.creds.loginUrl ?? 'https://login.salesforce.com';
    try {
      const r = await this.query<SalesforceQueryRecord>('SELECT Id FROM User LIMIT 1');
      return {
        ok: true,
        details: `OAuth ok (${loginUrl}); sample query returned ${r.length} row(s)`,
      };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const hint = msg.includes('INVALID_GRANT') || msg.includes('invalid_grant')
        ? '. Refresh token may be expired or revoked — re-run `sf org login web --alias mdas-prod`'
        : '';
      return { ok: false, details: `${msg}${hint}` };
    }
  }
}

/**
 * Read SALESFORCE_* env vars and return SalesforceCredentials, or null if
 * any required variable is missing. Adapters call this and return early
 * with empty results when null — the worker shouldn't crash on missing
 * creds in dev environments.
 */
export function readSalesforceCredsFromEnv(): SalesforceCredentials | null {
  const e = process.env;
  if (
    !e.SALESFORCE_CLIENT_ID ||
    !e.SALESFORCE_REFRESH_TOKEN ||
    !e.SALESFORCE_INSTANCE_URL
  ) {
    return null;
  }
  return {
    clientId: e.SALESFORCE_CLIENT_ID,
    clientSecret: e.SALESFORCE_CLIENT_SECRET ?? '',
    refreshToken: e.SALESFORCE_REFRESH_TOKEN,
    instanceUrl: e.SALESFORCE_INSTANCE_URL,
    apiVersion: e.SALESFORCE_API_VERSION,
    loginUrl: e.SALESFORCE_LOGIN_URL || undefined,
  };
}

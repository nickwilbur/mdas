// SalesforceClient — thin wrapper around a jsforce Connection.
//
// Read-only by construction:
//   - Only exposes query (REST) and bulk2.query (Bulk API 2.0) methods.
//   - No create / update / upsert / destroy / delete methods are exported.
//   - The CI guard (scripts/ci-guard.mjs) greps adapter source for write
//     verbs as a defense-in-depth check.
//
// Auth model: OAuth refresh-token grant. The refresh token is stored as a
// secret (env or Docker secret) and exchanged for an access token on first
// use. Access tokens are cached in-memory for their lifetime; on 401 we
// transparently refresh once and retry.
import { Connection, OAuth2 } from 'jsforce';

export interface SalesforceCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** e.g., https://zuora.my.salesforce.com */
  instanceUrl: string;
  /** Optional: pin a Salesforce REST API version. Defaults to 59.0. */
  apiVersion?: string;
}

export interface SalesforceQueryRecord {
  Id: string;
  [field: string]: unknown;
}

export class SalesforceClient {
  private connection: Connection | null = null;
  private accessToken: string | null = null;

  constructor(private readonly creds: SalesforceCredentials) {}

  private async ensureConnection(): Promise<Connection> {
    if (this.connection) return this.connection;

    const oauth2 = new OAuth2({
      clientId: this.creds.clientId,
      clientSecret: this.creds.clientSecret,
      // No redirectUri needed for refresh_token grant.
    });

    // Exchange the refresh token for an access token. jsforce's
    // oauth2.refreshToken returns a TokenResponse but doesn't construct
    // the Connection for us, so we issue the call ourselves and pass the
    // access token through the Connection ctor.
    const tokenRes = await oauth2.refreshToken(this.creds.refreshToken);
    this.accessToken = tokenRes.access_token;

    this.connection = new Connection({
      oauth2,
      instanceUrl: this.creds.instanceUrl,
      accessToken: this.accessToken,
      version: this.creds.apiVersion ?? '59.0',
      // jsforce tries to refresh on session_id_invalid automatically when
      // we attach the OAuth2 instance + refreshToken via a refresh handler.
      refreshFn: async (_conn: Connection, callback: (err: Error | null, accessToken?: string) => void) => {
        try {
          const fresh = await oauth2.refreshToken(this.creds.refreshToken);
          this.accessToken = fresh.access_token;
          callback(null, fresh.access_token);
        } catch (err) {
          callback(err as Error);
        }
      },
    });

    return this.connection;
  }

  /**
   * Run a SOQL query via the REST API. Use for queries returning < 2,000
   * rows. For larger or historical pulls, use bulkQuery() instead.
   *
   * Auto-paginates: jsforce's Connection.query handles the `nextRecordsUrl`
   * cursor when `autoFetch: true` is set on `queryAll`. We use the simpler
   * `query` and check `done` ourselves so we can return a single array.
   */
  async query<T extends SalesforceQueryRecord = SalesforceQueryRecord>(
    soql: string,
  ): Promise<T[]> {
    const conn = await this.ensureConnection();
    const out: T[] = [];
    let result = await conn.query<T>(soql);
    out.push(...(result.records as T[]));
    while (!result.done && result.nextRecordsUrl) {
      // jsforce exposes queryMore on the connection; type-narrowed via cast.
      result = await (conn as unknown as {
        queryMore: <R>(url: string) => Promise<{
          records: R[];
          done: boolean;
          nextRecordsUrl?: string;
          totalSize: number;
        }>;
      }).queryMore<T>(result.nextRecordsUrl);
      out.push(...(result.records as T[]));
    }
    return out;
  }

  /**
   * Bulk API 2.0 query. Use for queries that may return > 2,000 rows or
   * span historical data. jsforce's bulk2 client streams CSV server-side
   * and we collect into an array.
   */
  async bulkQuery<T extends SalesforceQueryRecord = SalesforceQueryRecord>(
    soql: string,
  ): Promise<T[]> {
    const conn = await this.ensureConnection();
    // jsforce's bulk2 client returns a record stream; collect into an array.
    // Types here are loose because jsforce's bulk2 typings vary by version.
    const records = (await (conn as unknown as {
      bulk2: { query: <R>(soql: string) => Promise<R[]> };
    }).bulk2.query<T>(soql)) as T[];
    return records;
  }

  /**
   * Health check used by adapter.healthCheck() — verifies token can be
   * obtained and a trivial SELECT runs without error. Returns details
   * suitable for surfacing on the dashboard's "Source freshness" panel.
   */
  async healthCheck(): Promise<{ ok: boolean; details: string }> {
    try {
      await this.ensureConnection();
      const r = await this.query<SalesforceQueryRecord>('SELECT Id FROM User LIMIT 1');
      return {
        ok: true,
        details: `OAuth ok; sample query returned ${r.length} row(s)`,
      };
    } catch (err) {
      return { ok: false, details: (err as Error).message };
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
    !e.SALESFORCE_CLIENT_SECRET ||
    !e.SALESFORCE_REFRESH_TOKEN ||
    !e.SALESFORCE_INSTANCE_URL
  ) {
    return null;
  }
  return {
    clientId: e.SALESFORCE_CLIENT_ID,
    clientSecret: e.SALESFORCE_CLIENT_SECRET,
    refreshToken: e.SALESFORCE_REFRESH_TOKEN,
    instanceUrl: e.SALESFORCE_INSTANCE_URL,
    apiVersion: e.SALESFORCE_API_VERSION,
  };
}

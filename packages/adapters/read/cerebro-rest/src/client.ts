// Typed read-only REST client for Zuora Cerebro (Cerebro Engage API token).

import { readOnlyGuard } from '../../_shared/src/index.js';
import type { CerebroRestCredentials } from './config.js';
import {
  CerebroApiError as ApiError,
  type CerebroAccountDetailsBatch,
  type CerebroAccountEngagementSummary,
  type CerebroGuideResponse,
  type CerebroRequestMeta,
  type CerebroWhoAmI,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
}

/** Transient transport errors worth a retry (timeouts + undici network resets). */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

export function isRetryableNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; code?: string; cause?: unknown };
  const msg = (e.message ?? '').toLowerCase();
  if (e.name === 'AbortError' || msg.includes('abort')) return true;
  if (msg.includes('fetch failed') || msg.includes('socket hang up') || msg.includes('network')) {
    return true;
  }
  if (e.code && TRANSIENT_NETWORK_CODES.has(e.code)) return true;
  const cause = e.cause as { code?: string; message?: string } | undefined;
  if (cause?.code && TRANSIENT_NETWORK_CODES.has(cause.code)) return true;
  if (cause?.message && cause.message.toLowerCase().includes('timeout')) return true;
  return false;
}

export interface CerebroRestClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Optional per-refresh collector for structured observability. */
  stats?: import('./stats.js').CerebroRestStatsCollector;
}

export class CerebroRestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly stats?: import('./stats.js').CerebroRestStatsCollector;

  constructor(creds: CerebroRestCredentials, opts: CerebroRestClientOptions = {}) {
    this.baseUrl = creds.baseUrl.replace(/\/$/, '');
    this.token = creds.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.stats = opts.stats;
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      authorization: `Bearer ${this.token}`,
    };
  }

  private async request<T>(
    method: 'GET' | 'HEAD' | 'POST',
    path: string,
    intent: string,
    jsonBody?: unknown,
  ): Promise<{ data: T; meta: CerebroRequestMeta }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = this.headers();
    if (jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const resp = await readOnlyGuard(url, {
          method,
          headers,
          body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
          signal: controller.signal,
          intent,
        });
        clearTimeout(timer);
        const meta: CerebroRequestMeta = {
          status: resp.status,
          requestId: resp.headers.get('x-request-id') ?? undefined,
          durationMs: Date.now() - started,
        };
        if (resp.ok) {
          const text = await resp.text();
          const data = text ? (JSON.parse(text) as T) : ({} as T);
          this.stats?.record(intent, meta.durationMs);
          return { data, meta };
        }
        const errBody = await resp.text().catch(() => '');
        const err = classifyHttpError(resp.status, errBody);
        if (RETRYABLE_STATUSES.has(resp.status) && attempt < MAX_RETRIES - 1) {
          this.stats?.record(intent, Date.now() - started, { retry: true });
          await sleep(backoffMs(attempt));
          continue;
        }
        this.stats?.record(intent, Date.now() - started, { error: true });
        throw err;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (err instanceof ApiError) throw err;
        // Retry transient transport failures (abort/timeout + Node undici
        // network errors). Under batch concurrency the corp Cerebro
        // endpoint intermittently resets connections, surfaced as a bare
        // `TypeError: fetch failed` with the real cause on `err.cause`.
        // These are not surfaced as HTTP statuses, so without retrying
        // them ~30% of account-details batches were silently dropped and
        // the workbench showed "Cerebro narrative not synced".
        if (isRetryableNetworkError(err) && attempt < MAX_RETRIES - 1) {
          this.stats?.record(intent, Date.now() - started, { retry: true });
          await sleep(backoffMs(attempt));
          continue;
        }
        if (!(err instanceof ApiError)) {
          this.stats?.record(intent, Date.now() - started, { error: true });
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Cerebro REST retries exhausted');
  }

  async whoami(): Promise<{ data: CerebroWhoAmI; meta: CerebroRequestMeta }> {
    return this.request<CerebroWhoAmI>('GET', '/api/whoami', 'cerebro:whoami');
  }

  async fetchApiGuide(): Promise<{ data: CerebroGuideResponse; meta: CerebroRequestMeta }> {
    return this.request<CerebroGuideResponse>('GET', '/api/guide/api', 'cerebro:guide-api');
  }

  async fetchMcpGuide(): Promise<{ data: CerebroGuideResponse; meta: CerebroRequestMeta }> {
    return this.request<CerebroGuideResponse>('GET', '/api/guide', 'cerebro:guide-mcp');
  }

  /** Account drill-down batch (1–10 Salesforce account IDs). */
  async postAccountDetails(
    salesforceAccountIds: string[],
  ): Promise<{ data: CerebroAccountDetailsBatch; meta: CerebroRequestMeta }> {
    return this.request<CerebroAccountDetailsBatch>(
      'POST',
      '/api/accounts/details',
      'cerebro:account-details',
      { salesforceAccountIds },
    );
  }

  async getEngagementSummary(
    salesforceAccountId: string,
  ): Promise<{ data: CerebroAccountEngagementSummary; meta: CerebroRequestMeta }> {
    const id = encodeURIComponent(salesforceAccountId);
    return this.request<CerebroAccountEngagementSummary>(
      'GET',
      `/api/engagement/accounts/${id}/summary`,
      'cerebro:engagement-summary',
    );
  }
}

export function classifyHttpError(status: number, body: string): ApiError {
  const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
  switch (status) {
    case 401:
      return new ApiError(
        'Cerebro authentication failed — token missing, expired, or invalid. Mint a new token in Cerebro Engage → Settings → API Tokens.',
        status,
        'auth_invalid',
      );
    case 403:
      return new ApiError(
        'Cerebro permission denied — your Engage account lacks access to this resource.',
        status,
        'permission_denied',
      );
    case 404:
      return new ApiError('Cerebro resource not found.', status, 'not_found');
    case 409:
      return new ApiError('Cerebro conflict.', status, 'conflict');
    case 422:
      return new ApiError(
        snippet ? `Cerebro validation error: ${snippet}` : 'Cerebro validation error.',
        status,
        'validation',
      );
    case 429:
      return new ApiError('Cerebro rate limit exceeded.', status, 'rate_limit');
    default:
      if (status >= 500) {
        return new ApiError(
          `Cerebro server error (${status}).`,
          status,
          'server_error',
        );
      }
      return new ApiError(
        snippet ? `Cerebro HTTP ${status}: ${snippet}` : `Cerebro HTTP ${status}`,
        status,
      );
  }
}

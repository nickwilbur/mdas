// Typed read-only REST client for Zuora Cerebro (Cerebro Engage API token).

import { readOnlyGuard } from '../../_shared/src/index.js';
import type { CerebroRestCredentials } from './config.js';
import {
  CerebroApiError as ApiError,
  type CerebroAccountDetailsBatch,
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

export interface CerebroRestClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CerebroRestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: CerebroRestCredentials, opts: CerebroRestClientOptions = {}) {
    this.baseUrl = creds.baseUrl.replace(/\/$/, '');
    this.token = creds.token;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
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
          return { data, meta };
        }
        const errBody = await resp.text().catch(() => '');
        const err = classifyHttpError(resp.status, errBody);
        if (RETRYABLE_STATUSES.has(resp.status) && attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (err instanceof ApiError) throw err;
        const msg = (err as Error).message ?? String(err);
        if (msg.includes('abort') && attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs(attempt));
          continue;
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

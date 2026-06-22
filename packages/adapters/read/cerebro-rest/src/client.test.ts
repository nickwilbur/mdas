import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CerebroRestClient, classifyHttpError, isRetryableNetworkError } from './client.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtures = (name: string) =>
  JSON.parse(readFileSync(join(__dir, 'fixtures', name), 'utf8'));
const whoamiSuccess = fixtures('whoami-success.json');
const accountDetailsSuccess = fixtures('account-details-success.json');

const BASE = 'https://cerebro-mcp.corpdata.zuora.com';
const CREDS = { baseUrl: BASE, token: 'test-token' };

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

describe('CerebroRestClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Authorization bearer header on whoami', async () => {
    let auth = '';
    vi.stubGlobal(
      'fetch',
      mockFetch((_url, init) => {
        auth = String((init?.headers as Record<string, string>)?.authorization ?? '');
        return new Response(JSON.stringify(whoamiSuccess), { status: 200 });
      }),
    );
    const client = new CerebroRestClient(CREDS);
    const { data } = await client.whoami();
    expect(auth).toBe('Bearer test-token');
    expect(data.email).toBe('engineer@zuora.com');
  });

  it('parses account details batch success', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((url, init) => {
        if (url.includes('/api/accounts/details') && init?.method === 'POST') {
          return new Response(JSON.stringify(accountDetailsSuccess), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    const client = new CerebroRestClient(CREDS);
    const { data } = await client.postAccountDetails(['0017000000FAKEACE']);
    expect(data.items[0]?.customerState?.risks?.riskCategory).toBe('High');
    expect(data.notFound).toEqual([]);
  });

  it('throws on 401', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => new Response('Unauthorized', { status: 401 })),
    );
    const client = new CerebroRestClient(CREDS);
    await expect(client.whoami()).rejects.toMatchObject({ status: 401 });
  });

  it('throws on 403', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => new Response('Forbidden', { status: 403 })),
    );
    const client = new CerebroRestClient(CREDS);
    await expect(client.whoami()).rejects.toMatchObject({ status: 403 });
  });

  it('throws on 422 validation', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => new Response('bad body', { status: 422 })),
    );
    const client = new CerebroRestClient(CREDS);
    await expect(client.postAccountDetails([])).rejects.toMatchObject({
      status: 422,
    });
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      mockFetch(() => {
        calls += 1;
        if (calls === 1) return new Response('rate limited', { status: 429 });
        return new Response(JSON.stringify(whoamiSuccess), { status: 200 });
      }),
    );
    const client = new CerebroRestClient(CREDS);
    await client.whoami();
    expect(calls).toBe(2);
  });

  it('retries on 503', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      mockFetch(() => {
        calls += 1;
        if (calls < 3) return new Response('error', { status: 503 });
        return new Response(JSON.stringify(whoamiSuccess), { status: 200 });
      }),
    );
    const client = new CerebroRestClient(CREDS);
    await client.whoami();
    expect(calls).toBe(3);
  });

  it('retries on transient "fetch failed" network error then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('fetch failed'));
        return Promise.resolve(new Response(JSON.stringify(whoamiSuccess), { status: 200 }));
      }) as typeof fetch,
    );
    const client = new CerebroRestClient(CREDS);
    await client.whoami();
    expect(calls).toBe(2);
  });

  it('does not retry on 401 auth errors', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      mockFetch(() => {
        calls += 1;
        return new Response('unauthorized', { status: 401 });
      }),
    );
    const client = new CerebroRestClient(CREDS);
    await expect(client.whoami()).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('classifyHttpError', () => {
  it('maps 422 validation', () => {
    const err = classifyHttpError(422, '{"detail":"bad filter"}');
    expect(err.code).toBe('validation');
  });
});

describe('isRetryableNetworkError', () => {
  it('treats undici fetch-failed with ECONNRESET cause as retryable', () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNRESET' };
    expect(isRetryableNetworkError(err)).toBe(true);
  });

  it('treats abort as retryable', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(isRetryableNetworkError(err)).toBe(true);
  });

  it('does not treat a plain validation error as retryable', () => {
    expect(isRetryableNetworkError(new Error('bad input'))).toBe(false);
  });
});

describe('fixtures', () => {
  it('openapi subset loads', () => {
    const spec = fixtures('openapi-subset.json');
    expect(spec.paths['/api/whoami']).toBeDefined();
  });
});

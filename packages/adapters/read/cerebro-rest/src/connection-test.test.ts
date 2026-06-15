import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCerebroConnectionTest } from './connection-test.js';
import { CerebroRestClient } from './client.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const whoamiSuccess = JSON.parse(
  readFileSync(join(__dir, 'fixtures/whoami-success.json'), 'utf8'),
);

const CREDS = {
  baseUrl: 'https://cerebro-mcp.corpdata.zuora.com',
  token: 'test-token',
};

describe('runCerebroConnectionTest', () => {
  it('reports success when whoami and guide succeed', async () => {
    const mockClient = {
      whoami: vi.fn().mockResolvedValue({
        data: whoamiSuccess,
        meta: { status: 200, durationMs: 10 },
      }),
      fetchApiGuide: vi.fn().mockResolvedValue({
        data: { guide: { endpoints: [] } },
        meta: { status: 200, durationMs: 12 },
      }),
      postAccountDetails: vi.fn().mockResolvedValue({
        data: { items: [], notFound: ['001000000000000AAA'] },
        meta: { status: 200, durationMs: 8 },
      }),
    } as unknown as CerebroRestClient;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    const result = await runCerebroConnectionTest(CREDS, mockClient);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.step === 'auth_valid' && d.ok)).toBe(true);
    vi.unstubAllGlobals();
  });
});

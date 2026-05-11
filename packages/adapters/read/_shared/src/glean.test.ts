import { describe, expect, it } from 'vitest';
import { parseJwtExpiry, GleanClient, type TokenStatus } from './glean.js';

// ---------------------------------------------------------------------------
// parseJwtExpiry
// ---------------------------------------------------------------------------

/** Build a minimal JWT with the given payload (no real signature). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

describe('parseJwtExpiry', () => {
  it('detects an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const status = parseJwtExpiry(fakeJwt({ exp }));
    expect(status.expired).toBe(true);
    expect(status.expiresAt).toBeInstanceOf(Date);
    expect(status.ttlSeconds).toBeLessThan(0);
  });

  it('detects a valid token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1h from now
    const status = parseJwtExpiry(fakeJwt({ exp }));
    expect(status.expired).toBe(false);
    expect(status.ttlSeconds).toBeGreaterThan(0);
  });

  it('returns non-expired for a non-JWT string', () => {
    const status = parseJwtExpiry('not-a-jwt');
    expect(status.expired).toBe(false);
    expect(status.expiresAt).toBeNull();
    expect(status.ttlSeconds).toBeNull();
  });

  it('returns non-expired for a JWT without exp claim', () => {
    const status = parseJwtExpiry(fakeJwt({ sub: 'user' }));
    expect(status.expired).toBe(false);
    expect(status.expiresAt).toBeNull();
  });

  it('handles malformed base64 payload gracefully', () => {
    const status = parseJwtExpiry('a.!!!invalid!!!.c');
    expect(status.expired).toBe(false);
    expect(status.expiresAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GleanClient — token expiry fast-path
// ---------------------------------------------------------------------------

describe('GleanClient token expiry', () => {
  it('surfaces expired token in tokenStatus at construction', () => {
    const exp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
    const client = new GleanClient({
      token: fakeJwt({ exp }),
      baseUrl: 'https://example.glean.com/mcp/default',
    });
    expect(client.tokenStatus.expired).toBe(true);
  });

  it('throws immediately on search() with expired token (no HTTP call)', async () => {
    const exp = Math.floor(Date.now() / 1000) - 86400;
    const client = new GleanClient({
      token: fakeJwt({ exp }),
      baseUrl: 'https://example.glean.com/mcp/default',
    });
    await expect(
      client.search({ query: 'test' }),
    ).rejects.toThrow(/GLEAN_MCP_TOKEN is expired/);
  });

  it('healthCheck returns ok:false with actionable message for expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 86400;
    const client = new GleanClient({
      token: fakeJwt({ exp }),
      baseUrl: 'https://example.glean.com/mcp/default',
    });
    const result = await client.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/GLEAN_MCP_TOKEN.*expired/);
    expect(result.details).toMatch(/make glean-token/);
  });

  it('reports valid token status for a non-expired JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
    const client = new GleanClient({
      token: fakeJwt({ exp }),
      baseUrl: 'https://example.glean.com/mcp/default',
    });
    expect(client.tokenStatus.expired).toBe(false);
    expect(client.tokenStatus.ttlSeconds).toBeGreaterThan(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseJwtExpiry,
  GleanClient,
  isFreshEnoughToSkip,
  resolveGleanEnrichLimit,
  type TokenStatus,
} from './glean.js';

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

// ---------------------------------------------------------------------------
// resolveGleanEnrichLimit — central policy for GLEAN_ENRICH_LIMIT
// ---------------------------------------------------------------------------

describe('resolveGleanEnrichLimit', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GLEAN_ENRICH_LIMIT;
    delete process.env.GLEAN_ENRICH_LIMIT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GLEAN_ENRICH_LIMIT;
    else process.env.GLEAN_ENRICH_LIMIT = saved;
  });

  it('returns 0 (no cap) when unset', () => {
    expect(resolveGleanEnrichLimit()).toBe(0);
  });

  // Regression: previously `Number("0") || 50 === 50` made the documented
  // "set to 0 to disable cap" pattern a silent no-op.
  it('returns 0 (no cap) when explicitly set to "0"', () => {
    process.env.GLEAN_ENRICH_LIMIT = '0';
    expect(resolveGleanEnrichLimit()).toBe(0);
  });

  it('returns the numeric cap when set to a positive integer', () => {
    process.env.GLEAN_ENRICH_LIMIT = '25';
    expect(resolveGleanEnrichLimit()).toBe(25);
  });

  it('returns 0 (no cap) for negative or non-numeric values', () => {
    process.env.GLEAN_ENRICH_LIMIT = '-5';
    expect(resolveGleanEnrichLimit()).toBe(0);
    process.env.GLEAN_ENRICH_LIMIT = 'banana';
    expect(resolveGleanEnrichLimit()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isFreshEnoughToSkip — per-account freshness skip for Glean adapters
// ---------------------------------------------------------------------------

describe('isFreshEnoughToSkip', () => {
  let savedHours: string | undefined;
  let savedForce: string | undefined;
  beforeEach(() => {
    savedHours = process.env.GLEAN_FRESHNESS_HOURS;
    savedForce = process.env.FORCE_REFRESH;
    delete process.env.GLEAN_FRESHNESS_HOURS;
    delete process.env.FORCE_REFRESH;
  });
  afterEach(() => {
    if (savedHours === undefined) delete process.env.GLEAN_FRESHNESS_HOURS;
    else process.env.GLEAN_FRESHNESS_HOURS = savedHours;
    if (savedForce === undefined) delete process.env.FORCE_REFRESH;
    else process.env.FORCE_REFRESH = savedForce;
  });

  it('returns false when lastFetched is undefined (never refreshed)', () => {
    expect(isFreshEnoughToSkip(undefined)).toBe(false);
  });

  it('returns true for a timestamp within the freshness window', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isFreshEnoughToSkip(oneHourAgo)).toBe(true);
  });

  it('returns false for a timestamp older than the freshness window', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(isFreshEnoughToSkip(twoDaysAgo)).toBe(false);
  });

  it('honors GLEAN_FRESHNESS_HOURS override', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    // Default 24h → fresh.
    expect(isFreshEnoughToSkip(fiveHoursAgo)).toBe(true);
    // Tighten to 1h → stale.
    process.env.GLEAN_FRESHNESS_HOURS = '1';
    expect(isFreshEnoughToSkip(fiveHoursAgo)).toBe(false);
  });

  it('FORCE_REFRESH=1 bypasses the freshness check entirely', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isFreshEnoughToSkip(oneHourAgo)).toBe(true);
    process.env.FORCE_REFRESH = '1';
    expect(isFreshEnoughToSkip(oneHourAgo)).toBe(false);
  });

  it('treats a malformed timestamp as stale (fail-open: do the refresh)', () => {
    expect(isFreshEnoughToSkip('not-a-date')).toBe(false);
  });

  it('treats a future timestamp as stale (fail-open: do the refresh)', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isFreshEnoughToSkip(future)).toBe(false);
  });
});

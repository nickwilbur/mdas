import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAllowedCerebroBaseUrl, readCerebroCredsFromEnv } from './config.js';

describe('readCerebroCredsFromEnv', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of ['CEREBRO_API_TOKEN', 'CEREBRO_BASE_URL']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ['CEREBRO_API_TOKEN', 'CEREBRO_BASE_URL']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null when token missing', () => {
    expect(readCerebroCredsFromEnv()).toBeNull();
  });

  it('returns creds with default base URL', () => {
    process.env.CEREBRO_API_TOKEN = 'secret';
    const creds = readCerebroCredsFromEnv();
    expect(creds?.baseUrl).toBe('https://cerebro-mcp.corpdata.zuora.com');
  });

  it('rejects disallowed base URL hosts', () => {
    process.env.CEREBRO_API_TOKEN = 'secret';
    process.env.CEREBRO_BASE_URL = 'https://evil.example.com';
    expect(readCerebroCredsFromEnv()).toBeNull();
  });
});

describe('assertAllowedCerebroBaseUrl', () => {
  it('allows corpdata host', () => {
    expect(assertAllowedCerebroBaseUrl('https://cerebro-mcp.corpdata.zuora.com')).toContain(
      'corpdata',
    );
  });
});

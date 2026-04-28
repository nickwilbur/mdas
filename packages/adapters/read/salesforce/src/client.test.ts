// Regression tests for readSalesforceCredsFromEnv. The "empty client secret"
// case is the path used when MDAS authenticates via Salesforce's built-in
// PlatformCLI Connected App (a public OAuth client with no secret).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSalesforceCredsFromEnv } from './client';

const KEYS = [
  'SALESFORCE_CLIENT_ID',
  'SALESFORCE_CLIENT_SECRET',
  'SALESFORCE_REFRESH_TOKEN',
  'SALESFORCE_INSTANCE_URL',
  'SALESFORCE_API_VERSION',
] as const;

describe('readSalesforceCredsFromEnv', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null when nothing is set', () => {
    expect(readSalesforceCredsFromEnv()).toBeNull();
  });

  it('returns null when client_id is missing', () => {
    process.env.SALESFORCE_CLIENT_SECRET = 'sec';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    process.env.SALESFORCE_INSTANCE_URL = 'https://x.my.salesforce.com';
    expect(readSalesforceCredsFromEnv()).toBeNull();
  });

  it('returns null when refresh_token is missing', () => {
    process.env.SALESFORCE_CLIENT_ID = 'PlatformCLI';
    process.env.SALESFORCE_INSTANCE_URL = 'https://x.my.salesforce.com';
    expect(readSalesforceCredsFromEnv()).toBeNull();
  });

  it('returns null when instance_url is missing', () => {
    process.env.SALESFORCE_CLIENT_ID = 'PlatformCLI';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    expect(readSalesforceCredsFromEnv()).toBeNull();
  });

  it('accepts a missing client_secret (PlatformCLI public-client path)', () => {
    process.env.SALESFORCE_CLIENT_ID = 'PlatformCLI';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    process.env.SALESFORCE_INSTANCE_URL = 'https://zuora.my.salesforce.com';
    const creds = readSalesforceCredsFromEnv();
    expect(creds).not.toBeNull();
    expect(creds!.clientId).toBe('PlatformCLI');
    expect(creds!.clientSecret).toBe('');
    expect(creds!.refreshToken).toBe('r');
  });

  it('accepts an empty-string client_secret (PlatformCLI in shell .env)', () => {
    process.env.SALESFORCE_CLIENT_ID = 'PlatformCLI';
    process.env.SALESFORCE_CLIENT_SECRET = '';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    process.env.SALESFORCE_INSTANCE_URL = 'https://zuora.my.salesforce.com';
    const creds = readSalesforceCredsFromEnv();
    expect(creds).not.toBeNull();
    expect(creds!.clientSecret).toBe('');
  });

  it('passes through a custom api_version', () => {
    process.env.SALESFORCE_CLIENT_ID = 'PlatformCLI';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    process.env.SALESFORCE_INSTANCE_URL = 'https://x.my.salesforce.com';
    process.env.SALESFORCE_API_VERSION = '60.0';
    expect(readSalesforceCredsFromEnv()!.apiVersion).toBe('60.0');
  });

  it('returns full credentials with a real client_secret (custom Connected App path)', () => {
    process.env.SALESFORCE_CLIENT_ID = 'CustomApp';
    process.env.SALESFORCE_CLIENT_SECRET = 'shh';
    process.env.SALESFORCE_REFRESH_TOKEN = 'r';
    process.env.SALESFORCE_INSTANCE_URL = 'https://x.my.salesforce.com';
    expect(readSalesforceCredsFromEnv()).toEqual({
      clientId: 'CustomApp',
      clientSecret: 'shh',
      refreshToken: 'r',
      instanceUrl: 'https://x.my.salesforce.com',
      apiVersion: undefined,
    });
  });
});

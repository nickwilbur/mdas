import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SalesforceClient, readSalesforceCredsFromEnv } from '../packages/adapters/read/salesforce/src/client.js';

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env');
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const creds = readSalesforceCredsFromEnv();
  if (!creds) throw new Error('missing creds');

  // Step 1: native fetch OAuth (should be fast)
  const loginUrl = (creds.loginUrl ?? 'https://login.salesforce.com').replace(/\/$/, '');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: creds.clientId,
    refresh_token: creds.refreshToken,
  });
  const t0 = Date.now();
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  console.log('oauth', `${Date.now() - t0}ms`, res.status, json.error ?? 'ok');

  // Step 2: jsforce healthCheck (OAuth + query)
  const client = new SalesforceClient(creds);
  const t1 = Date.now();
  console.log('healthCheck starting...');
  const hc = await Promise.race([
    client.healthCheck(),
    new Promise<{ ok: false; details: string }>((_, rej) =>
      setTimeout(() => rej(new Error('healthCheck timeout 45s')), 45_000),
    ),
  ]);
  console.log('healthCheck', `${Date.now() - t1}ms`, hc);
  if (!hc.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});

// glean-oauth.mjs — shared helpers for the in-repo Glean OAuth flow.
//
// Glean's MCP server speaks OAuth 2.1 with:
//   - Dynamic Client Registration (RFC 7591) at the AS metadata's
//     `registration_endpoint`. We use it once on first login so the
//     repo doesn't need a pre-provisioned client_id.
//   - PKCE S256 on the authorization_code grant.
//   - refresh_token grant for silent renewal (requires `offline_access`
//     scope at authorize time).
//
// The login + refresh scripts share endpoint discovery, JWT inspection,
// and `.env` upsert via this module. Keep it dependency-free (only
// node:* imports) so `node scripts/glean-login.mjs` works without an
// `npm install`.

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const ENV_PATH = resolve(REPO_ROOT, '.env');
// DCR client credentials + refresh_token live OUTSIDE .env so they don't
// pollute env-var space loaded by docker-compose / Next.js. .env stays
// for "things the running app reads". This file is for "things the
// login/refresh scripts persist between runs". Gitignored.
export const OAUTH_STATE_PATH = resolve(REPO_ROOT, '.glean-oauth.json');

// ---------------------------------------------------------------------------
// Defaults

// Override with GLEAN_MCP_URL if you use a different Glean server.
export const DEFAULT_MCP_URL = 'https://zuora-be.glean.com/mcp/default';
// Mirrors the scope set Cursor / Windsurf request. `offline_access` is
// mandatory if you want a refresh_token back.
export const DEFAULT_SCOPES = [
  'activity',
  'agents',
  'answers',
  'chat',
  'collections',
  'documents',
  'email',
  'entities',
  'feed',
  'feedback',
  'insights',
  'llm_proxy',
  'mcp',
  'offline_access',
  'openid',
  'people',
  'pins',
  'search',
  'shortcuts',
  'summarize',
  'tools',
];

// ---------------------------------------------------------------------------
// Endpoint discovery
//
// Given the MCP URL, derive the issuer's origin and fetch
// /.well-known/oauth-authorization-server. We deliberately do NOT
// hard-code endpoint URLs so a future server move (or tenant migration)
// is automatic.

export function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export async function discoverAsMetadata(mcpUrl) {
  const origin = originOf(mcpUrl);
  const metaUrl = `${origin}/.well-known/oauth-authorization-server`;
  const res = await fetch(metaUrl);
  if (!res.ok) {
    throw new Error(
      `AS metadata fetch failed: GET ${metaUrl} -> ${res.status} ${res.statusText}`,
    );
  }
  const meta = await res.json();
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (typeof meta[field] !== 'string') {
      throw new Error(`AS metadata missing required field: ${field}`);
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------
// PKCE

function base64urlEncode(buf) {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function generatePkcePair() {
  const verifier = base64urlEncode(randomBytes(32));
  const challenge = base64urlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateState() {
  return base64urlEncode(randomBytes(16));
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
//
// One-shot at first login. The returned client_id is public (PKCE
// flow with `token_endpoint_auth_method=none`); no secret is issued.

export async function registerClient(metadata, redirectUri) {
  const res = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'MDAS Local Dev',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`DCR failed: ${res.status} ${res.statusText} — ${body.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`DCR returned non-JSON: ${body.slice(0, 200)}`);
  }
  if (typeof json.client_id !== 'string') {
    throw new Error(`DCR response missing client_id: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Token endpoint

export async function exchangeAuthorizationCode({
  tokenEndpoint,
  clientId,
  code,
  redirectUri,
  codeVerifier,
}) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  return await postToken(tokenEndpoint, params);
}

export async function refreshAccessToken({ tokenEndpoint, clientId, refreshToken, scope }) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
  if (scope) params.set('scope', scope);
  return await postToken(tokenEndpoint, params);
}

async function postToken(tokenEndpoint, params) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: params.toString(),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `token endpoint ${res.status} ${res.statusText} — ${body.slice(0, 400)}`,
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`token endpoint returned non-JSON: ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// JWT introspection (decode-only — never verify locally; the API server
// is the source of truth)

export function jwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
  } catch {
    return null;
  }
}

export function jwtExpiry(jwt) {
  const p = jwtPayload(jwt);
  return p && typeof p.exp === 'number' ? p.exp : null;
}

export function fingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function formatTtl(ttlSeconds) {
  if (ttlSeconds == null) return 'unknown TTL';
  const sign = ttlSeconds < 0 ? '-' : '';
  const abs = Math.abs(ttlSeconds);
  const hours = Math.floor(abs / 3600);
  const days = Math.floor(hours / 24);
  return `${sign}${days}d ${hours % 24}h`;
}

// ---------------------------------------------------------------------------
// .env upsert

export function upsertEnvVar(envText, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(envText)) return envText.replace(re, line);
  const prefix = envText.endsWith('\n') || envText.length === 0 ? envText : envText + '\n';
  return `${prefix}${line}\n`;
}

export function writeEnvVar(key, value) {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  writeFileSync(ENV_PATH, upsertEnvVar(text, key, value), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// OAuth state file (DCR client_id + refresh_token + endpoints, scoped
// per MCP URL so multiple tenants can coexist).
//
// Shape:
//   {
//     "https://zuora-be.glean.com/mcp/default": {
//       "client_id": "...",
//       "registered_at": "...",
//       "issuer": "https://zuora-be.glean.com/oauth",
//       "authorization_endpoint": "...",
//       "token_endpoint": "...",
//       "registration_endpoint": "...",
//       "scope": "...",
//       "refresh_token": "..."
//     }
//   }

export function readState() {
  if (!existsSync(OAUTH_STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OAUTH_STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(state) {
  mkdirSync(dirname(OAUTH_STATE_PATH), { recursive: true });
  writeFileSync(OAUTH_STATE_PATH, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(OAUTH_STATE_PATH, 0o600);
  } catch {
    // best-effort
  }
}

export function readStateFor(mcpUrl) {
  const all = readState();
  return all[mcpUrl] ?? null;
}

export function writeStateFor(mcpUrl, entry) {
  const all = readState();
  all[mcpUrl] = entry;
  writeState(all);
}

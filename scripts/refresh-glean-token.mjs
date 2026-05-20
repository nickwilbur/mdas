#!/usr/bin/env node
// refresh-glean-token.mjs
//
// Refresh GLEAN_MCP_TOKEN in .env. Tries sources in order:
//
//   1. In-repo refresh_token (.glean-oauth.json) — silent, no editor.
//      This is the path we want everyone on. Bootstrap once with
//      `node scripts/glean-login.mjs`.
//   2. Cursor's encrypted MCP token store (macOS Keychain).
//   3. Windsurf's encrypted MCP token store (macOS Keychain).
//
// First source to produce a non-expired access_token wins. Override
// with GLEAN_TOKEN_SOURCE=in-repo|cursor|windsurf to force one.
//
// Why all three: the in-repo path is the long-term target, but for
// developers who already have Cursor/Windsurf authenticated against
// Glean (and aren't ready to redo their OAuth dance) the editor scrape
// is a zero-effort upgrade path. Both eventually drop out — see
// docs/integrations/glean.md "Option B" for the per-user multi-user
// path that obsoletes this script entirely.
//
// Usage:
//   node scripts/refresh-glean-token.mjs
//   # then: ./restart.sh   (or: docker compose restart web worker)
//
// Platform: macOS for editor-scrape; any platform for in-repo refresh.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import {
  DEFAULT_MCP_URL,
  fingerprint,
  formatTtl,
  jwtExpiry,
  readStateFor,
  refreshAccessToken,
  writeEnvVar,
  writeStateFor,
} from './lib/glean-oauth.mjs';

const MCP_URL = process.env.GLEAN_MCP_URL || DEFAULT_MCP_URL;
const GLEAN_SERVER_NAME = process.env.GLEAN_SERVER_NAME || 'default';

// ---------------------------------------------------------------------------
// Source 1: in-repo refresh_token grant (preferred)

async function loadInRepo() {
  const state = readStateFor(MCP_URL);
  if (!state) return { skipped: 'no .glean-oauth.json entry — run `node scripts/glean-login.mjs` to bootstrap' };
  if (!state.refresh_token) return { skipped: '.glean-oauth.json has no refresh_token (was offline_access scope granted?)' };
  if (!state.client_id || !state.token_endpoint) return { skipped: '.glean-oauth.json incomplete (missing client_id or token_endpoint)' };

  let tokens;
  try {
    tokens = await refreshAccessToken({
      tokenEndpoint: state.token_endpoint,
      clientId: state.client_id,
      refreshToken: state.refresh_token,
    });
  } catch (err) {
    return { skipped: `refresh_token grant failed (${err.message})` };
  }
  if (typeof tokens.access_token !== 'string') {
    return { skipped: 'token response missing access_token' };
  }
  // Persist rotated refresh_token if the AS issued one.
  const newRefresh =
    typeof tokens.refresh_token === 'string' ? tokens.refresh_token : state.refresh_token;
  writeStateFor(MCP_URL, {
    ...state,
    refresh_token: newRefresh,
    last_refreshed_at: new Date().toISOString(),
  });
  return tokenResult(tokens.access_token);
}

// ---------------------------------------------------------------------------
// Sources 2-3: scrape Cursor / Windsurf encrypted MCP token stores

function getKeychainPassword(service) {
  return execFileSync('security', ['find-generic-password', '-s', service, '-w'])
    .toString()
    .trim();
}

function decryptElectronSafeStorage(encrypted, password) {
  // Electron safeStorage on macOS:
  //   prefix: 'v10' (or 'v11')
  //   key:    PBKDF2-SHA1(password, salt='saltysalt', iter=1003, dkLen=16)
  //   IV:     b'                ' (16 spaces)
  //   AES-128-CBC + PKCS7 padding
  const prefix = encrypted.subarray(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v11') {
    throw new Error(`Unexpected safeStorage prefix: ${JSON.stringify(prefix)}`);
  }
  const ciphertext = encrypted.subarray(3);
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function readEncryptedTokenBlob(vscdbPath, secretKey) {
  if (!existsSync(vscdbPath)) return null;
  let raw;
  try {
    raw = execFileSync(
      'sqlite3',
      [vscdbPath, `SELECT value FROM ItemTable WHERE key = '${secretKey.replace(/'/g, "''")}';`],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
  const text = raw.toString('utf8').trim();
  if (!text) return null;
  const buf = JSON.parse(text);
  return Buffer.from(buf.data);
}

// Walk a decrypted blob looking for a JWT-shaped access_token. Editors
// disagree on shape: Cursor stores an array/object envelope; Windsurf
// stores a flat { access_token, ... }.
function extractAccessToken(blob) {
  if (typeof blob === 'string') {
    const t = blob.trim();
    if (t.split('.').length === 3) return t;
    return null;
  }
  if (blob && typeof blob === 'object') {
    if (typeof blob.access_token === 'string') return blob.access_token;
    if (typeof blob.accessToken === 'string') return blob.accessToken;
    if (Array.isArray(blob)) {
      for (const entry of blob) {
        const t = extractAccessToken(entry);
        if (t) return t;
      }
      return null;
    }
    for (const v of Object.values(blob)) {
      const t = extractAccessToken(v);
      if (t) return t;
    }
  }
  return null;
}

function makeEditorLoader({ label, keychainService, vscdbPath, secretKey }) {
  return function loadEditor() {
    let password;
    try {
      password = getKeychainPassword(keychainService);
    } catch (err) {
      return { skipped: `Keychain '${keychainService}' not found (${err.message.split('\n')[0]})` };
    }
    const encrypted = readEncryptedTokenBlob(vscdbPath, secretKey);
    if (!encrypted) return { skipped: `no token entry in ${vscdbPath}` };
    let decrypted;
    try {
      decrypted = decryptElectronSafeStorage(encrypted, password);
    } catch (err) {
      return { skipped: `decrypt failed (${err.message})` };
    }
    const decryptedText = decrypted.toString('utf8');
    let tokenBlob;
    try {
      tokenBlob = JSON.parse(decryptedText);
    } catch {
      tokenBlob = decryptedText;
    }
    const token = extractAccessToken(tokenBlob);
    if (!token) {
      const preview =
        typeof tokenBlob === 'object'
          ? `keys=${JSON.stringify(Object.keys(tokenBlob))}`
          : `type=${typeof tokenBlob}`;
      return { skipped: `no access_token in decrypted blob (${preview})` };
    }
    return tokenResult(token);
  };
}

function tokenResult(token) {
  const exp = jwtExpiry(token);
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = exp ? exp - now : null;
  return { token, exp, ttlSeconds };
}

// ---------------------------------------------------------------------------
// Source registry. Order matters: in-repo first.

const SOURCES = [
  { id: 'in-repo', label: 'in-repo refresh_token', load: loadInRepo },
  {
    id: 'cursor',
    label: 'Cursor',
    load: makeEditorLoader({
      label: 'Cursor',
      keychainService: 'Cursor Safe Storage',
      vscdbPath: resolve(
        homedir(),
        'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
      ),
      // Cursor stores the URL as unpadded base64 (no trailing '=').
      secretKey: (() => {
        const urlB64 = Buffer.from(MCP_URL, 'utf8').toString('base64').replace(/=+$/, '');
        return `secret://{"extensionId":"anysphere.cursor-mcp","key":"[url:${urlB64}] mcp_tokens"}`;
      })(),
    }),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    load: makeEditorLoader({
      label: 'Windsurf',
      keychainService: 'Windsurf Safe Storage',
      vscdbPath: resolve(
        homedir(),
        'Library/Application Support/Windsurf/User/globalStorage/state.vscdb',
      ),
      secretKey:
        `secret://{"extensionId":"codeium.windsurf","key":"mcp_token_glean_${GLEAN_SERVER_NAME}"}`,
    }),
  },
];

// ---------------------------------------------------------------------------
// Main

async function main() {
  const forced = process.env.GLEAN_TOKEN_SOURCE;
  const candidates = forced ? SOURCES.filter((s) => s.id === forced) : SOURCES;
  if (forced && candidates.length === 0) {
    throw new Error(
      `Unknown GLEAN_TOKEN_SOURCE=${JSON.stringify(forced)}. ` +
        `Expected one of: ${SOURCES.map((s) => s.id).join(', ')}.`,
    );
  }

  const attempts = [];
  let picked = null;
  for (const source of candidates) {
    let result;
    try {
      result = await source.load();
    } catch (err) {
      result = { skipped: `load threw: ${err.message}` };
    }
    attempts.push({ source, result });
    if (result.token) {
      const expired = result.ttlSeconds != null && result.ttlSeconds < 0;
      if (!expired || forced) {
        picked = { source, result };
        break;
      }
    }
  }

  if (!picked) {
    const lines = attempts.map((a) => {
      if (a.result.token) {
        return `  - ${a.source.label}: token found but expired ${formatTtl(a.result.ttlSeconds)} ago`;
      }
      return `  - ${a.source.label}: ${a.result.skipped}`;
    });
    throw new Error(
      `No usable Glean MCP token found.\n${lines.join('\n')}\n\n` +
        `Bootstrap the in-repo OAuth flow once:\n` +
        `  node scripts/glean-login.mjs\n` +
        `From then on, this script (and worker cron) refreshes silently.`,
    );
  }

  const { source, result } = picked;
  writeEnvVar('GLEAN_MCP_TOKEN', result.token);

  console.log(`[refresh-glean-token] wrote GLEAN_MCP_TOKEN to .env (from ${source.label})`);
  console.log(`  fingerprint:  ${fingerprint(result.token)}`);
  if (result.ttlSeconds != null) {
    console.log(`  expires in:   ${formatTtl(result.ttlSeconds)} (exp=${result.exp})`);
  }
  for (const a of attempts) {
    if (a.source.id === source.id) continue;
    if (a.result.token && a.result.ttlSeconds != null && a.result.ttlSeconds < 0) {
      console.log(`  (skipped ${a.source.label}: expired ${formatTtl(a.result.ttlSeconds)} ago)`);
    } else if (!a.result.token) {
      console.log(`  (skipped ${a.source.label}: ${a.result.skipped})`);
    }
  }
  console.log('');
  console.log('Next: ./restart.sh');
}

main().catch((err) => {
  console.error(`[refresh-glean-token] ERROR: ${err.message}`);
  process.exit(1);
});

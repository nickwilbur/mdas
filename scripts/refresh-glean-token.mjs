#!/usr/bin/env node
// refresh-glean-token.mjs
//
// Hack for local dev only. Reads the OAuth access_token Windsurf
// negotiated with Glean's MCP server and writes it into the repo-root
// `.env` as GLEAN_MCP_TOKEN. Run this whenever the in-app /api/glean/*
// routes return 401 Invalid Secret — the token has a ~1-week TTL
// (configurable per Glean tenant) and gets rotated by Windsurf's
// silent-refresh logic in the background.
//
// Why this exists: Glean's MCP server requires OAuth 2.1 (Dynamic
// Client Registration + PKCE + Okta SSO) and rejects static bearer
// tokens. Windsurf already runs that flow on your behalf and stores
// the resulting access_token AES-encrypted in VS Code's secret
// storage, with the AES key in macOS Keychain ("Windsurf Safe
// Storage"). This script just decrypts that one entry.
//
// Once we wire up our own Glean OAuth flow in the app
// (AUTH_MODE=okta path → GleanOAuthClient), this script can be
// deleted.
//
// Usage:
//   node scripts/refresh-glean-token.mjs
//   # then: docker compose restart web
//
// Platform: macOS only. Linux/Windows would need DPAPI/libsecret
// equivalents.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, pbkdf2Sync, createDecipheriv } from 'node:crypto';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(REPO_ROOT, '.env');
const VSCDB_PATH = resolve(
  homedir(),
  'Library/Application Support/Windsurf/User/globalStorage/state.vscdb',
);
const SECRET_KEY =
  'secret://{"extensionId":"codeium.windsurf","key":"mcp_token_glean_default"}';

function getKeychainPassword() {
  try {
    return execFileSync('security', [
      'find-generic-password',
      '-s',
      'Windsurf Safe Storage',
      '-w',
    ])
      .toString()
      .trim();
  } catch (err) {
    throw new Error(
      `Failed to read 'Windsurf Safe Storage' from macOS Keychain. ` +
        `Make sure Windsurf has been launched at least once and is signed in. ` +
        `(${err.message})`,
    );
  }
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

function readEncryptedTokenBlob() {
  if (!existsSync(VSCDB_PATH)) {
    throw new Error(`Windsurf state DB not found at ${VSCDB_PATH}`);
  }
  // Shell out to the system sqlite3 CLI (always present on macOS) to
  // avoid pulling in a native binding just for this dev script.
  let raw;
  try {
    raw = execFileSync(
      'sqlite3',
      [VSCDB_PATH, `SELECT value FROM ItemTable WHERE key = '${SECRET_KEY.replace(/'/g, "''")}';`],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    throw new Error(`sqlite3 query failed: ${err.message}`);
  }
  const text = raw.toString('utf8').trim();
  if (!text) {
    throw new Error(
      `No Glean MCP token entry in Windsurf state DB. ` +
        `Open Windsurf, run a Glean MCP tool once (search/chat/read_document), ` +
        `then re-run this script.`,
    );
  }
  // The value column stores the JSON-stringified Buffer ({type:'Buffer',data:[...]}).
  const buf = JSON.parse(text);
  return Buffer.from(buf.data);
}

function jwtExpiry(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8',
      ),
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function upsertEnvVar(envText, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(envText)) {
    return envText.replace(re, line);
  }
  // Append, ensuring the file ends with a newline.
  const prefix = envText.endsWith('\n') || envText.length === 0 ? envText : envText + '\n';
  return `${prefix}${line}\n`;
}

function main() {
  const password = getKeychainPassword();
  const encrypted = readEncryptedTokenBlob();
  const decrypted = decryptElectronSafeStorage(encrypted, password);
  const tokenBlob = JSON.parse(decrypted.toString('utf8'));
  const accessToken = tokenBlob.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error(
      'Decrypted blob has no access_token. Got keys: ' +
        JSON.stringify(Object.keys(tokenBlob)),
    );
  }
  const exp = jwtExpiry(accessToken);
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = exp ? exp - now : null;

  const envText = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const updated = upsertEnvVar(envText, 'GLEAN_MCP_TOKEN', accessToken);
  writeFileSync(ENV_PATH, updated, { mode: 0o600 });

  // Print a fingerprint, never the full token.
  const fp = createHash('sha256').update(accessToken).digest('hex').slice(0, 12);
  console.log('[refresh-glean-token] wrote GLEAN_MCP_TOKEN to .env');
  console.log(`  fingerprint:  ${fp}`);
  if (ttlSeconds !== null) {
    const hours = Math.floor(ttlSeconds / 3600);
    const days = Math.floor(hours / 24);
    console.log(`  expires in:   ${days}d ${hours % 24}h (exp=${exp})`);
  }
  const scope = Array.isArray(tokenBlob.scope) ? tokenBlob.scope.join(' ') : tokenBlob.scope ?? '';
  console.log(`  scope:        ${scope}`);
  console.log('');
  console.log('Next: docker compose restart web');
}

main();

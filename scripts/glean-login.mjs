#!/usr/bin/env node
// glean-login.mjs
//
// In-repo Glean OAuth login. Replaces the editor-scrape hack in
// scripts/refresh-glean-token.mjs for local dev — no Cursor / Windsurf
// install needed.
//
// Flow:
//   1. Discover AS metadata at <glean-origin>/.well-known/oauth-authorization-server.
//   2. (One-shot) Dynamic Client Registration to mint a client_id for
//      a `http://127.0.0.1:<port>/callback` redirect URI. Cached in
//      .glean-oauth.json so subsequent logins reuse the same client.
//   3. Start a loopback HTTP server on a free port.
//   4. Open the system browser to the authorize URL (PKCE S256, state,
//      scope including `offline_access` for refresh tokens).
//   5. Receive the code on the loopback, exchange it for tokens.
//   6. Persist refresh_token + DCR client in .glean-oauth.json, write
//      access_token to .env as GLEAN_MCP_TOKEN.
//
// Subsequent expirations are handled by scripts/glean-refresh.mjs which
// uses the saved refresh_token to silently mint a new access_token
// without re-opening the browser.
//
// Usage:
//   node scripts/glean-login.mjs                          # default tenant
//   GLEAN_MCP_URL=https://acme-be.glean.com/mcp/default \
//     node scripts/glean-login.mjs                        # other tenant
//
// Platform: any. macOS/Linux/Windows all supported (uses `open`/`xdg-open`/`start`).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import {
  DEFAULT_MCP_URL,
  DEFAULT_SCOPES,
  discoverAsMetadata,
  exchangeAuthorizationCode,
  fingerprint,
  formatTtl,
  generatePkcePair,
  generateState,
  jwtExpiry,
  jwtPayload,
  readStateFor,
  registerClient,
  writeEnvVar,
  writeStateFor,
} from './lib/glean-oauth.mjs';

const MCP_URL = process.env.GLEAN_MCP_URL || DEFAULT_MCP_URL;
const SCOPES = (process.env.GLEAN_SCOPES?.split(/[, ]+/).filter(Boolean)) || DEFAULT_SCOPES;
const FORCE_REGISTER = process.env.GLEAN_FORCE_REGISTER === '1';

function openBrowser(url) {
  // Best-effort. Print the URL too so headless / SSH sessions still
  // work — the user can paste it into a local browser.
  console.log('');
  console.log('→ If your browser doesn\'t open automatically, visit:');
  console.log(`  ${url}`);
  console.log('');
  const p = platform();
  let cmd;
  let args;
  if (p === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (p === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore — user has the URL printed above
  }
}

// Start a loopback HTTP server on a kernel-assigned free port and
// return { port, codePromise }. The codePromise resolves with { code }
// once Glean redirects back with a successful authorization code (or
// rejects on error / state mismatch).
function startCallbackServer({ expectedState }) {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const params = url.searchParams;
      const error = params.get('error');
      const code = params.get('code');
      const state = params.get('state');
      const body = (heading, sub) =>
        `<!doctype html><html><head><meta charset="utf-8">` +
        `<title>MDAS Glean login</title>` +
        `<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0f17;color:#e6edf3}` +
        `.card{max-width:480px;padding:32px;border:1px solid #30363d;border-radius:12px;background:#161b22}` +
        `h1{margin:0 0 8px;font-size:18px} p{margin:0;color:#8b949e;font-size:14px;line-height:1.5}</style>` +
        `</head><body><div class="card"><h1>${heading}</h1><p>${sub}</p></div></body></html>`;
      if (error) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body('Login failed', `Glean returned <code>${error}</code>. Check the terminal for details.`));
        setTimeout(() => server.close(), 100);
        rejectCode(new Error(`authorize error: ${error} ${params.get('error_description') ?? ''}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body('Login failed', 'No authorization code in callback.'));
        setTimeout(() => server.close(), 100);
        rejectCode(new Error('callback missing ?code'));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body('Login failed', 'state mismatch — possible CSRF. Re-run the login.'));
        setTimeout(() => server.close(), 100);
        rejectCode(new Error('state mismatch'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body('You\'re signed in', 'You can close this tab and return to the terminal.'));
      setTimeout(() => server.close(), 250);
      resolveCode({ code });
    });
    server.on('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectServer(new Error('unexpected loopback bind address'));
        return;
      }
      resolveServer({ port: addr.port, codePromise, server });
    });
  });
}

async function main() {
  console.log(`[glean-login] tenant: ${MCP_URL}`);

  console.log('[glean-login] discovering AS metadata...');
  const metadata = await discoverAsMetadata(MCP_URL);
  console.log(`  issuer:        ${metadata.issuer}`);
  console.log(`  authorize:     ${metadata.authorization_endpoint}`);
  console.log(`  token:         ${metadata.token_endpoint}`);
  console.log(`  registration:  ${metadata.registration_endpoint}`);

  // Bind the loopback server early so we know the port → know the
  // exact redirect_uri to register / send to /authorize.
  const expectedState = generateState();
  console.log('[glean-login] starting loopback callback server...');
  const { port, codePromise } = await startCallbackServer({ expectedState });
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  console.log(`  redirect_uri:  ${redirectUri}`);

  // Reuse a cached DCR client_id when redirect_uri (= port) matches.
  // Glean's DCR accepts any 127.0.0.1 port per RFC 8252, so we can
  // also re-register if the previous client has a stale port baked in.
  // Simpler: re-register every time. DCR is cheap and avoids matching
  // logic. Override with cached entry only when GLEAN_FORCE_REGISTER
  // is unset AND the saved redirect matches.
  const cached = readStateFor(MCP_URL);
  let clientId;
  let registered = false;
  if (
    cached &&
    cached.client_id &&
    cached.redirect_uri === redirectUri &&
    !FORCE_REGISTER
  ) {
    clientId = cached.client_id;
    console.log(`[glean-login] reusing cached client_id ${clientId.slice(0, 8)}…`);
  } else {
    console.log('[glean-login] performing dynamic client registration...');
    const reg = await registerClient(metadata, redirectUri);
    clientId = reg.client_id;
    registered = true;
    console.log(`  client_id:    ${clientId}`);
  }

  const { verifier, challenge } = generatePkcePair();
  const scopeStr = SCOPES.join(' ');
  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scopeStr);
  authorizeUrl.searchParams.set('state', expectedState);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('[glean-login] opening browser for Okta SSO consent...');
  openBrowser(authorizeUrl.toString());

  const { code } = await codePromise;
  console.log('[glean-login] code received, exchanging for tokens...');
  const tokens = await exchangeAuthorizationCode({
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    code,
    redirectUri,
    codeVerifier: verifier,
  });

  if (typeof tokens.access_token !== 'string') {
    throw new Error(`token response missing access_token: ${JSON.stringify(tokens).slice(0, 200)}`);
  }
  const accessToken = tokens.access_token;
  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null;
  const grantedScope = typeof tokens.scope === 'string' ? tokens.scope : scopeStr;

  writeEnvVar('GLEAN_MCP_TOKEN', accessToken);
  writeStateFor(MCP_URL, {
    client_id: clientId,
    registered_at: registered ? new Date().toISOString() : cached?.registered_at,
    redirect_uri: redirectUri,
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint,
    scope: grantedScope,
    refresh_token: refreshToken ?? cached?.refresh_token ?? null,
  });

  const exp = jwtExpiry(accessToken);
  const now = Math.floor(Date.now() / 1000);
  const ttl = exp ? exp - now : null;
  const payload = jwtPayload(accessToken);
  console.log('');
  console.log('[glean-login] success');
  console.log(`  fingerprint:  ${fingerprint(accessToken)}`);
  if (ttl != null) console.log(`  expires in:   ${formatTtl(ttl)}`);
  if (payload?.sub) console.log(`  subject:      ${payload.sub}`);
  console.log(`  refresh:      ${refreshToken ? 'saved (scripts/glean-refresh.mjs)' : 'NOT issued — ensure `offline_access` is in scopes'}`);
  console.log('');
  console.log('Next: ./restart.sh');
}

main().catch((err) => {
  console.error(`[glean-login] ERROR: ${err.message}`);
  process.exit(1);
});

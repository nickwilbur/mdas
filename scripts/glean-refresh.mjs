#!/usr/bin/env node
// glean-refresh.mjs
//
// Silent refresh of GLEAN_MCP_TOKEN in .env using the refresh_token
// previously saved by scripts/glean-login.mjs into .glean-oauth.json.
// No browser, no editor required. Safe to run from a cron / pre-job
// hook before any worker run.
//
// If the refresh_token itself is rejected (e.g. server-side
// invalidated, or `offline_access` was not granted at login), this
// script prints a clear message telling you to re-run
// `node scripts/glean-login.mjs` to do the full interactive flow.
//
// Usage:
//   node scripts/glean-refresh.mjs
//   # then: ./restart.sh

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

async function main() {
  const state = readStateFor(MCP_URL);
  if (!state || !state.refresh_token || !state.client_id || !state.token_endpoint) {
    console.error(
      `[glean-refresh] no saved OAuth state for ${MCP_URL}.\n` +
        `  Run \`node scripts/glean-login.mjs\` once to do the interactive\n` +
        `  OAuth flow; that writes .glean-oauth.json so future refreshes\n` +
        `  can run silently.`,
    );
    process.exit(1);
  }

  let tokens;
  try {
    tokens = await refreshAccessToken({
      tokenEndpoint: state.token_endpoint,
      clientId: state.client_id,
      refreshToken: state.refresh_token,
      // Don't send `scope` on refresh — the AS will reissue with the
      // originally granted scope set, which is what we want. Including
      // it risks getting a *narrower* token if the AS interprets the
      // request as a downscope.
    });
  } catch (err) {
    console.error(`[glean-refresh] refresh_token grant failed: ${err.message}`);
    console.error('');
    console.error('Likely causes:');
    console.error('  - refresh_token was revoked (e.g. password change / SSO logout)');
    console.error('  - server-side token rotation limit reached');
    console.error('  - DCR client was deleted from Glean admin');
    console.error('');
    console.error('Fix: re-run `node scripts/glean-login.mjs` to re-authenticate.');
    process.exit(2);
  }

  if (typeof tokens.access_token !== 'string') {
    console.error(`[glean-refresh] token response missing access_token: ${JSON.stringify(tokens).slice(0, 200)}`);
    process.exit(3);
  }
  const accessToken = tokens.access_token;
  // Some ASes rotate the refresh_token on every use (best practice).
  // Others keep it stable. Persist whatever we got back, if any.
  const newRefresh =
    typeof tokens.refresh_token === 'string' ? tokens.refresh_token : state.refresh_token;

  writeEnvVar('GLEAN_MCP_TOKEN', accessToken);
  writeStateFor(MCP_URL, {
    ...state,
    refresh_token: newRefresh,
    last_refreshed_at: new Date().toISOString(),
  });

  const exp = jwtExpiry(accessToken);
  const now = Math.floor(Date.now() / 1000);
  const ttl = exp ? exp - now : null;
  console.log('[glean-refresh] wrote new GLEAN_MCP_TOKEN to .env');
  console.log(`  fingerprint:  ${fingerprint(accessToken)}`);
  if (ttl != null) console.log(`  expires in:   ${formatTtl(ttl)}`);
  if (newRefresh !== state.refresh_token) {
    console.log('  refresh_token rotated and saved.');
  }
  console.log('');
  console.log('Next: ./restart.sh');
}

main().catch((err) => {
  console.error(`[glean-refresh] ERROR: ${err.message}`);
  process.exit(1);
});

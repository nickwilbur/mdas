// In-app auth + Glean credential resolution.
//
// Today MDAS runs in two auth postures:
//
//   AUTH_MODE=none  (default)  Single-user / localhost. Uses the static
//                              GLEAN_MCP_TOKEN bearer (the same one the
//                              worker pipeline uses). Token never leaves
//                              the Node process — the browser only ever
//                              talks to /api/glean/*.
//
//   AUTH_MODE=okta              Per-user OAuth via Okta. Each authenticated
//                              user's session carries a Glean access token
//                              minted from their Okta identity. Requires
//                              an Okta admin to register the MDAS app as
//                              an OIDC client and a Glean admin to accept
//                              that client. Until both tickets land this
//                              mode is a *scaffold only* — the route
//                              handlers will return 501 with a clear
//                              "ask your admin" error so a manager flipping
//                              the flag prematurely gets actionable output.
//
// All Next.js route handlers under /api/glean call resolveGleanCredsForRequest()
// rather than reading env vars directly. That gives us one place to add
// the OBO token exchange when admin tickets land — no fan-out edits.

import { readGleanCredsFromEnv, type GleanCredentials } from '@mdas/adapter-shared/glean';

export type AuthMode = 'none' | 'okta';

export function getAuthMode(): AuthMode {
  const v = (process.env.AUTH_MODE ?? 'none').toLowerCase();
  return v === 'okta' ? 'okta' : 'none';
}

export interface ResolvedGleanCreds {
  /** Bearer token + base URL ready to hand to GleanClient. */
  creds: GleanCredentials;
  /** Identity behind the token, surfaced to the UI status badge. */
  principal: { kind: 'service' | 'user'; label: string };
}

export class GleanCredsUnavailable extends Error {
  /** HTTP status the route handler should return. */
  readonly status: number;
  /** Stable code for the UI to branch on (e.g. show a "configure" prompt). */
  readonly code:
    | 'no-token'
    | 'okta-not-implemented'
    | 'okta-misconfigured'
    | 'okta-no-session';
  constructor(code: GleanCredsUnavailable['code'], status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'GleanCredsUnavailable';
  }
}

/**
 * Resolve a Glean credential for the current request. Throws
 * `GleanCredsUnavailable` (with an HTTP status) when no usable credential
 * exists — route handlers catch and surface as JSON.
 */
export async function resolveGleanCredsForRequest(
  _req: Request,
): Promise<ResolvedGleanCreds> {
  const mode = getAuthMode();

  if (mode === 'okta') {
    // Scaffold: see apps/web/src/app/api/auth/[...nextauth]/route.ts and
    // docs/integrations/glean.md "Option B" for the admin checklist.
    // Until the OIDC client is registered + Glean OBO is enabled we can't
    // exchange an Okta access token for a Glean one. Surface 501 so the
    // UI can render an "Ask Glean/Okta admin" empty state.
    throw new GleanCredsUnavailable(
      'okta-not-implemented',
      501,
      'AUTH_MODE=okta is a scaffold. Complete the Okta + Glean admin steps '
        + 'in docs/integrations/glean.md ("Option B") before enabling.',
    );
  }

  const creds = readGleanCredsFromEnv();
  if (!creds) {
    throw new GleanCredsUnavailable(
      'no-token',
      503,
      'GLEAN_MCP_TOKEN / GLEAN_MCP_BASE_URL not set. Add them to apps/web/.env '
        + 'or .env at the repo root and restart.',
    );
  }

  return {
    creds,
    principal: { kind: 'service', label: 'MDAS service token' },
  };
}

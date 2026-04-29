// Okta OAuth scaffold for AUTH_MODE=okta.
//
// Status: NOT WIRED. This handler intentionally returns 501 until two
// admin-side prerequisites are completed:
//
//   1. Okta admin: register MDAS as an OIDC application
//        - Type: Web (PKCE)
//        - Sign-in redirect URI: <APP_URL>/api/auth/okta/callback
//        - Sign-out redirect URI: <APP_URL>/
//        - Allowed grant types: Authorization Code + Refresh Token
//        - Note the client_id + client_secret → put in env as
//          OKTA_CLIENT_ID / OKTA_CLIENT_SECRET. The Okta domain →
//          OKTA_ISSUER (e.g. https://yourtenant.okta.com).
//        - Add an "audience" / scope for Glean (Okta + Glean docs:
//          https://developers.glean.com/docs/oauth/).
//
//   2. Glean admin: enable OAuth-mediated user-scoped access tokens for
//      the registered Okta client. (Glean → Admin → Authentication →
//      OAuth → "Allow on-behalf-of token issuance"; grant the client
//      the read scopes the worker uses today.) Without this the Okta
//      access_token won't be accepted by Glean's REST API.
//
// Once both are done, replace this handler with a NextAuth
// route (apps/web/src/app/api/auth/[...nextauth]/route.ts) using the
// Okta provider, store the access_token in the JWT, and update
// `apps/web/src/lib/auth.ts::resolveGleanCredsForRequest` to pull
// the per-user token off the session instead of GLEAN_MCP_TOKEN.
//
// Why a stub today: shipping a half-working OAuth flow is worse than
// no flow — partial NextAuth setup tends to silently fall back to
// session=null and produce confusing 401s. A loud 501 with admin
// instructions in the body is the right behaviour.
import { NextResponse } from 'next/server';
import { getAuthMode } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminChecklist(): Record<string, unknown> {
  return {
    error: 'AUTH_MODE=okta is not yet wired. Complete the admin prerequisites.',
    code: 'okta-not-implemented',
    prerequisites: [
      {
        owner: 'Okta admin',
        task: 'Register MDAS as an OIDC Web application with PKCE.',
        provides: ['OKTA_ISSUER', 'OKTA_CLIENT_ID', 'OKTA_CLIENT_SECRET'],
      },
      {
        owner: 'Glean admin',
        task: 'Allow OAuth-mediated user-scoped access tokens for the new Okta client.',
        provides: ['Glean OAuth audience / scopes'],
      },
      {
        owner: 'MDAS engineer (after the two above)',
        task: 'Replace this stub with a NextAuth Okta provider + Glean OBO token exchange in apps/web/src/lib/auth.ts.',
      },
    ],
    docs: 'docs/integrations/glean.md → "Option B — Per-user Okta OAuth"',
  };
}

export async function GET(): Promise<Response> {
  const mode = getAuthMode();
  if (mode !== 'okta') {
    return NextResponse.json(
      { error: `AUTH_MODE=${mode}. This route only responds when AUTH_MODE=okta.` },
      { status: 404 },
    );
  }
  return NextResponse.json(adminChecklist(), { status: 501 });
}

export async function POST(): Promise<Response> {
  return GET();
}

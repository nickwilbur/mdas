// Server-only helper that constructs a per-request GleanClient.
//
// Lifecycle: NEW client per request — the GleanClient's docCache is
// keyed to the worker's "per-refresh" model, but for the web app we
// scope it to the single API call so memory doesn't accumulate over a
// long-running Next process. (A request-level cache is still useful
// when search → getDocuments are chained in one handler.)
import 'server-only';
import { GleanClient } from '@mdas/adapter-shared/glean';
import {
  GleanCredsUnavailable,
  resolveGleanCredsForRequest,
  type ResolvedGleanCreds,
} from './auth';

export interface PerRequestGlean {
  client: GleanClient;
  principal: ResolvedGleanCreds['principal'];
}

export async function gleanForRequest(req: Request): Promise<PerRequestGlean> {
  const { creds, principal } = await resolveGleanCredsForRequest(req);
  return { client: new GleanClient(creds), principal };
}

/**
 * Wrap a route handler to centralize "credentials missing / wrong"
 * error rendering. Any other thrown error bubbles to Next's default
 * 500 handling so unexpected bugs are loud.
 */
export async function withGleanErrors<T>(
  fn: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GleanCredsUnavailable) {
      return new Response(
        JSON.stringify({ error: err.message, code: err.code }),
        { status: err.status, headers: { 'content-type': 'application/json' } },
      );
    }
    // Glean upstream / network failures are also worth surfacing as a
    // structured 502 rather than a 500: it tells the UI to show "Glean
    // unreachable, try again" instead of a generic crash.
    const msg = (err as Error)?.message ?? 'Glean call failed';
    if (/Glean (search|chat|getdocument) failed/i.test(msg)) {
      return new Response(
        JSON.stringify({ error: msg, code: 'glean-upstream' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }
    throw err;
  }
}

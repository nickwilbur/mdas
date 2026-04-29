// GET /api/glean/health
// Returns: { ok: boolean; details: string; principal?: { kind, label }; mode }
//
// The layout pings this on mount to render a "Connected to Glean" badge
// and to decide whether to enable the cmd-K command bar. Failure is
// expected when env vars aren't set (returns ok=false, code='no-token')
// — the UI shows a "Configure Glean" tooltip pointing at .env.example.
import { NextResponse } from 'next/server';
import {
  GleanCredsUnavailable,
  getAuthMode,
  resolveGleanCredsForRequest,
} from '@/lib/auth';
import { GleanClient } from '@mdas/adapter-shared/glean';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request): Promise<Response> {
  const mode = getAuthMode();
  try {
    const { creds, principal } = await resolveGleanCredsForRequest(req);
    const client = new GleanClient(creds);
    const probe = await client.healthCheck();
    return NextResponse.json({
      ok: probe.ok,
      details: probe.details,
      principal,
      mode,
    });
  } catch (err) {
    if (err instanceof GleanCredsUnavailable) {
      return NextResponse.json(
        { ok: false, details: err.message, code: err.code, mode },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { ok: false, details: (err as Error).message, mode },
      { status: 200 },
    );
  }
}

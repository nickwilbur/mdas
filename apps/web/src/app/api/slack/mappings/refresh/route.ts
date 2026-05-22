import { NextResponse } from 'next/server';
import { refreshMappings } from '@/lib/slack-mapping';
import { readSendGateConfigFromEnv } from '@mdas/slack-send';
import { assertXoxcSafetyOrThrow, XoxcSafetyError } from '@/lib/xoxc-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Synchronous refresh — the mapping pass is pure-DB (no Slack API calls)
// and bounded by the Expand-3 account count (a few hundred rows). The
// existing /api/refresh queue is reserved for the full adapter refresh
// which is materially heavier. A small in-process pass keeps this UX
// simple — the caller sees the summary in the response.
export async function POST(): Promise<Response> {
  // xoxc safety: refuse to make Slack API calls under a browser-session
  // token if the env file is git-tracked or .gitignore is missing
  // entries. Mapping refresh would emit real network calls under the
  // user's identity, so the leak risk is highest here.
  if (readSendGateConfigFromEnv().readTokenKind === 'xoxc') {
    try {
      assertXoxcSafetyOrThrow();
    } catch (e) {
      if (e instanceof XoxcSafetyError) {
        return NextResponse.json({ error: e.message }, { status: 500 });
      }
      throw e;
    }
  }
  const summary = await refreshMappings({ actor: 'manual:nick' });
  return NextResponse.json(summary);
}

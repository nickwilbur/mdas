// Per-row manual override API.
//
// POST /api/slack/mappings/override/:accountId
//   Body: { slackUrl: string, note?: string }
//   Sets a manual override that takes precedence over Salesforce. Used
//   to resolve heuristic_candidate / unresolved rows when the operator
//   knows the channel URL but Slack's `conversations.list` is blocked
//   at the enterprise level (the typical case at Zuora — see
//   list-channels.ts top-of-file note on `enterprise_is_restricted`).
//
// DELETE /api/slack/mappings/override/:accountId
//   Clears the override and re-runs precedence resolution for that
//   single account.
//
// xoxc-safety guard runs because override writes can trigger
// conversations.info validation under the xoxc token.

import { NextResponse } from 'next/server';
import { setManualOverride, clearManualOverride } from '@/lib/slack-mapping';
import { readSendGateConfigFromEnv } from '@mdas/slack-send';
import { assertXoxcSafetyOrThrow, XoxcSafetyError } from '@/lib/xoxc-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function xoxcGuard(): Response | null {
  if (readSendGateConfigFromEnv().readTokenKind === 'xoxc') {
    try {
      assertXoxcSafetyOrThrow();
    } catch (e) {
      if (e instanceof XoxcSafetyError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
      }
      throw e;
    }
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  const guard = xoxcGuard();
  if (guard) return guard;

  let body: { slackUrl?: string; note?: string };
  try {
    body = (await req.json()) as { slackUrl?: string; note?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be JSON: { slackUrl, note? }' },
      { status: 400 },
    );
  }
  if (!body.slackUrl || typeof body.slackUrl !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'slackUrl is required' },
      { status: 400 },
    );
  }

  const result = await setManualOverride({
    accountId: params.accountId,
    slackUrl: body.slackUrl,
    note: body.note ?? null,
    actor: 'manual:nick',
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  const guard = xoxcGuard();
  if (guard) return guard;

  const result = await clearManualOverride({
    accountId: params.accountId,
    actor: 'manual:nick',
  });
  return NextResponse.json(result);
}

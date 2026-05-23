// Bulk-promote heuristic_candidate rows from an operator-pasted Slack
// API response body (typically client.boot / client.counts /
// users.conversations from DevTools).
//
// POST /api/slack/mappings/promote-from-paste
//   Body: { paste: string }  (raw JSON string the operator pasted)
//   Returns: PromoteFromPasteResult
//
// This is the workaround for Zuora's `enterprise_is_restricted` policy
// on conversations.list — the operator's browser has read access that
// server-side tokens don't, so we route the channel list through the
// operator's clipboard rather than through Slack's API directly.
//
// No Slack API calls happen here. No xoxc-safety guard is required —
// nothing leaves the server. The paste itself is processed and
// discarded (audit row records only the counts, never the channel
// list itself, to avoid persisting names of private channels in an
// audit table that's queryable by other internal tools).

import { NextResponse } from 'next/server';
import { promoteFromPaste } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reasonable upper bound on the paste size. A Zuora-sized workspace's
// client.boot response is typically <2MB; 10MB is generous headroom
// without inviting accidental log-flooding pastes.
const MAX_PASTE_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  let body: { paste?: unknown };
  try {
    body = (await req.json()) as { paste?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be JSON: { paste: "<raw JSON from devtools>" }' },
      { status: 400 },
    );
  }
  if (typeof body.paste !== 'string' || body.paste.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'paste must be a non-empty string (the JSON response body from DevTools)' },
      { status: 400 },
    );
  }
  if (body.paste.length > MAX_PASTE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `paste too large (${body.paste.length} bytes; max ${MAX_PASTE_BYTES}). ` +
          `If your client.boot response is genuinely this big, copy just the channels array.`,
      },
      { status: 413 },
    );
  }

  const result = await promoteFromPaste({ paste: body.paste, actor: 'manual:nick' });
  return NextResponse.json(result, { status: result.parseError ? 400 : 200 });
}

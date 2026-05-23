// Bulk-promote heuristic_candidate rows from a HAR file (HTTP Archive)
// exported from the operator's browser DevTools while Slack web was
// open and loaded.
//
// Why HAR over the earlier paste approach:
//   - HAR contains response bodies of EVERY API call Slack made during
//     the recording, including endpoints we can't easily target by name
//     (the `x.slack.com/api/client.userBoot` endpoint, the
//     `edgeapi.slack.com/cache/<E>/channels/info` endpoints, etc.).
//   - The operator doesn't have to find the right Network row to copy —
//     they just save everything and we pick what we need.
//   - It handles the reality that Slack's Enterprise Grid Cmd+K search
//     uses a completely different API (Flannel/Loom edge endpoints)
//     than what's documented for OAuth apps.
//
// POST /api/slack/mappings/import-har
//   Multipart form: file=<the .har file>  OR  JSON body: { harText }
//   Returns: PromoteFromPasteResult & { harSources: [...] }
//
// No outbound Slack API calls; the HAR file is parsed in-process and
// discarded. Audit row records counts only (HAR contents include
// private channel names; we never persist them).

import { NextResponse } from 'next/server';
import { promoteFromHar } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// HAR files for a full Slack page load are typically 5-15 MB. Allow
// generous headroom; we'll fail fast on truly silly sizes (>100MB).
const MAX_HAR_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get('content-type') ?? '';
  let harText: string;

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `Could not parse multipart form: ${(e as Error).message}` },
        { status: 400 },
      );
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Multipart form must include a "file" field with the .har file.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_HAR_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `HAR file too large (${file.size} bytes; max ${MAX_HAR_BYTES}). ` +
            `If your HAR is genuinely this big, it likely captured non-Slack traffic — ` +
            `clear DevTools, reload only the Slack tab, and re-export.`,
        },
        { status: 413 },
      );
    }
    harText = await file.text();
  } else {
    // Fallback path: JSON body with { harText }. Useful for curl testing.
    let body: { harText?: unknown };
    try {
      body = (await req.json()) as { harText?: unknown };
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: 'Request must be either multipart/form-data with a "file" field, ' +
            'or application/json with { "harText": "<HAR JSON>" }.',
        },
        { status: 400 },
      );
    }
    if (typeof body.harText !== 'string' || body.harText.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'JSON body must include non-empty "harText".' },
        { status: 400 },
      );
    }
    if (body.harText.length > MAX_HAR_BYTES) {
      return NextResponse.json(
        { ok: false, error: `HAR text too large (${body.harText.length} bytes; max ${MAX_HAR_BYTES}).` },
        { status: 413 },
      );
    }
    harText = body.harText;
  }

  const result = await promoteFromHar({ harText, actor: 'manual:nick' });
  return NextResponse.json(result, { status: result.parseError ? 400 : 200 });
}

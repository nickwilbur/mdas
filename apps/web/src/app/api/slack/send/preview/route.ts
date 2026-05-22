import { NextResponse } from 'next/server';
import { previewSend } from '@/lib/slack-send-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-side validation in addition to the client validation. The UI
// could be bypassed (curl, the API is unauthed beyond the localhost-only
// AUTH_MODE=none posture) — we re-check shape here.
interface PreviewBody {
  accountId?: unknown;
  messageBody?: unknown;
  targetType?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (typeof body.accountId !== 'string' || !body.accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }
  if (typeof body.messageBody !== 'string' || !body.messageBody.trim()) {
    return NextResponse.json({ error: 'messageBody required' }, { status: 400 });
  }
  if (body.targetType !== 'customer_channel' && body.targetType !== 'self_test') {
    return NextResponse.json(
      { error: 'targetType must be customer_channel or self_test' },
      { status: 400 },
    );
  }

  const result = await previewSend({
    accountId: body.accountId,
    messageBody: body.messageBody,
    targetType: body.targetType,
    actor: 'manual:nick',
  });
  return NextResponse.json(result);
}

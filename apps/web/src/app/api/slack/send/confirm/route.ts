import { NextResponse } from 'next/server';
import { confirmSend } from '@/lib/slack-send-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConfirmBody {
  previewId?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.previewId !== 'string' || !body.previewId) {
    return NextResponse.json({ error: 'previewId required' }, { status: 400 });
  }
  try {
    const result = await confirmSend({ previewId: body.previewId, actor: 'manual:nick' });
    const status = result.result === 'sent' ? 200 : result.result === 'blocked' ? 403 : 502;
    return NextResponse.json(result, { status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';
import { cancelSend } from '@/lib/slack-send-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CancelBody {
  previewId?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: CancelBody;
  try {
    body = (await req.json()) as CancelBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.previewId !== 'string' || !body.previewId) {
    return NextResponse.json({ error: 'previewId required' }, { status: 400 });
  }
  try {
    const result = await cancelSend({ previewId: body.previewId, actor: 'manual:nick' });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

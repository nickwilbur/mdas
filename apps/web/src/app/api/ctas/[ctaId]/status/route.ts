import { NextResponse } from 'next/server';
import { updateCtaStatus, type CTAStatus } from '@/lib/cta-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED: CTAStatus[] = ['open', 'closed_done', 'stalled'];

export async function PATCH(
  request: Request,
  { params }: { params: { ctaId: string } },
): Promise<Response> {
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = body.status as CTAStatus | undefined;
  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED.join(', ')}` },
      { status: 400 },
    );
  }

  const result = updateCtaStatus(params.ctaId, status);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  console.info(
    JSON.stringify({
      msg: 'cta.status.updated',
      ctaId: params.ctaId,
      status,
    }),
  );

  return NextResponse.json({ ok: true, entry: result.entry });
}

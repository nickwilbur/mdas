import { NextResponse } from 'next/server';
import {
  ALLOWED_CTA_STATUSES,
  updateCtaProgress,
  type CtaProgressPatch,
} from '@/lib/cta-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: { ctaId: string } },
): Promise<Response> {
  let body: CtaProgressPatch;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    body.status == null &&
    body.assigned_owner === undefined &&
    body.due_date === undefined &&
    body.progress_note === undefined
  ) {
    return NextResponse.json(
      { error: 'At least one of status, assigned_owner, due_date, progress_note is required' },
      { status: 400 },
    );
  }

  if (body.status && !ALLOWED_CTA_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_CTA_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const result = updateCtaProgress(params.ctaId, body);
  if (!result.ok) {
    const status = result.error === 'CTA not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  console.info(
    JSON.stringify({
      msg: 'cta.progress.updated',
      ctaId: params.ctaId,
      patch: body,
    }),
  );

  return NextResponse.json({ ok: true, entry: result.entry });
}

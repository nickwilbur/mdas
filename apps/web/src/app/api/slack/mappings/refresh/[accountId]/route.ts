import { NextResponse } from 'next/server';
import { refreshMappings } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: { accountId: string } },
): Promise<Response> {
  const summary = await refreshMappings({
    actor: 'manual:nick',
    accountId: params.accountId,
  });
  return NextResponse.json(summary);
}

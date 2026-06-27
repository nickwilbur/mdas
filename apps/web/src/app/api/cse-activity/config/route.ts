import { NextResponse } from 'next/server';
import { loadCseActivityConfig, saveCseActivityConfig } from '@/lib/cse-activity/config';
import { mergeConfig, type CseActivityConfig } from '@mdas/cse-activity';

export async function GET(): Promise<Response> {
  return NextResponse.json(loadCseActivityConfig());
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as Partial<CseActivityConfig>;
    saveCseActivityConfig(mergeConfig(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

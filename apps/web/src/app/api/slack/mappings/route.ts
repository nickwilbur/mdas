import { NextResponse } from 'next/server';
import { listMappings } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-side handler that translates URL search params into typed
// listMappings options. We pass through every supported filter + sort
// query parameter as-is — listMappings (and the underlying
// buildMappingQuery helper) whitelists sort columns and binds every
// filter value, so it's safe to forward whatever the client sends.
//
// Numeric params are validated; non-numeric strings fall back to the
// listMappings defaults. Empty strings are coerced to undefined so they
// don't add empty ILIKE clauses.
function pickStr(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  if (v === null) return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '50');

  const result = await listMappings({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    status: pickStr(url, 'status'),
    source: pickStr(url, 'source'),
    q: pickStr(url, 'q'),
    channelIdQ: pickStr(url, 'channelIdQ'),
    channelNameQ: pickStr(url, 'channelNameQ'),
    refreshedAfter: pickStr(url, 'refreshedAfter'),
    refreshedBefore: pickStr(url, 'refreshedBefore'),
    sort: pickStr(url, 'sort'),
    dir: pickStr(url, 'dir'),
  });
  return NextResponse.json(result);
}

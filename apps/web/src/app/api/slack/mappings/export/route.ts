import { exportMappingsCsv } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickStr(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  if (v === null) return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { csv, rowCount, filename } = await exportMappingsCsv({
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

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Row-Count': String(rowCount),
    },
  });
}

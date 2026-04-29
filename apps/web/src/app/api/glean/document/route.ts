// POST /api/glean/document
// Body: { urls: string[] }
// Returns: { documents: { url, title, datasource, content, updateTime }[] }
//
// Used when the user clicks "preview" on a search result and we want
// the full body inline (instead of opening Glean's web UI in a new tab).
// Capped at 5 URLs per call to keep response sizes sane.
import { NextResponse } from 'next/server';
import { gleanForRequest, withGleanErrors } from '@/lib/glean-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DocBody {
  urls: string[];
}

export async function POST(req: Request): Promise<Response> {
  const out = await withGleanErrors(async () => {
    const body = (await req.json()) as Partial<DocBody>;
    const urls = (body.urls ?? []).filter((u) => typeof u === 'string').slice(0, 5);
    if (urls.length === 0) {
      return NextResponse.json(
        { error: 'urls is required (1-5)', code: 'bad-request' },
        { status: 400 },
      );
    }

    const { client } = await gleanForRequest(req);
    const docs = await client.getDocuments(urls);
    return NextResponse.json({
      documents: docs.map((d) => ({
        url: d.url ?? '',
        title: d.title ?? '(untitled)',
        datasource: d.datasource ?? '',
        // Glean's full body lives under richDocumentData.content — cap
        // at 20 KB inline; the user can always click through for more.
        content: (d.richDocumentData?.content ?? d.snippets?.join('\n\n') ?? '').slice(0, 20_000),
        updateTime: d.updateTime ?? d.createTime ?? null,
      })),
    });
  });
  return out instanceof Response ? out : out;
}

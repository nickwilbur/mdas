// POST /api/glean/search
// Body: { query: string; datasources?: string[]; pageSize?: number;
//         facetFilters?: GleanFacetFilter[] }
// Returns: { results: TrimmedDoc[], principal }
//
// Why a server proxy and not a direct browser-side call?
// 1. Token never leaves the Node process (the bearer in GLEAN_MCP_TOKEN
//    has broad read access to your tenant; never ship it to the client).
// 2. CORS — Glean's REST API does not advertise CORS for arbitrary
//    web origins, so browser fetches would be blocked anyway.
// 3. Lets us keep readOnlyGuard + intent tagging in one place
//    (per Section 2.6 of the refactor prompt).
import { NextResponse } from 'next/server';
import type {
  GleanDocument,
  GleanFacetFilter,
} from '@mdas/adapter-shared/glean';
import { gleanForRequest, withGleanErrors } from '@/lib/glean-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchBody {
  query: string;
  datasources?: string[];
  pageSize?: number;
  facetFilters?: GleanFacetFilter[];
}

interface TrimmedDoc {
  title: string;
  url: string;
  datasource: string;
  snippet: string;
  updateTime: string | null;
  citationId: string | null;
}

function trim(d: GleanDocument): TrimmedDoc {
  return {
    title: d.title ?? '(untitled)',
    url: d.url ?? '',
    datasource: d.datasource ?? '',
    snippet: (d.snippets?.[0] ?? '').slice(0, 320),
    updateTime: d.updateTime ?? d.createTime ?? null,
    citationId: d.citationId ?? null,
  };
}

export async function POST(req: Request): Promise<Response> {
  const out = await withGleanErrors(async () => {
    const body = (await req.json()) as Partial<SearchBody>;
    const query = (body.query ?? '').trim();
    if (!query) {
      return NextResponse.json(
        { error: 'query is required', code: 'bad-request' },
        { status: 400 },
      );
    }

    const { client, principal } = await gleanForRequest(req);
    const resp = await client.search({
      query,
      datasources: body.datasources?.length ? body.datasources : undefined,
      facetFilters: body.facetFilters,
      pageSize: Math.min(Math.max(body.pageSize ?? 25, 1), 100),
    });
    const docs = resp.documents ?? resp.results ?? [];
    return NextResponse.json({
      results: docs.filter((d) => d.url).map(trim),
      principal,
    });
  });
  return out instanceof Response ? out : out;
}

import { NextResponse } from 'next/server';
import { importSheetCsv } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Accepts either:
//   - Content-Type: text/csv         body = raw CSV text
//   - Content-Type: application/json body = { csv: "..." }
//
// This is the ONLY supported "sheet" source path — we deliberately do
// not fetch from Google Drive or scrape spreadsheets via Glean
// (forbidden by the codebase's "Glean is backup, never primary" rule
// and the explicit gdrive-out-of-scope policy in README.md).
export async function POST(req: Request): Promise<Response> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  let csv: string;
  if (ct.includes('application/json')) {
    const body = (await req.json()) as { csv?: unknown };
    if (typeof body.csv !== 'string' || !body.csv.trim()) {
      return NextResponse.json({ error: 'json body must include { csv: "..." }' }, { status: 400 });
    }
    csv = body.csv;
  } else {
    csv = await req.text();
    if (!csv.trim()) {
      return NextResponse.json({ error: 'empty CSV body' }, { status: 400 });
    }
  }

  const result = await importSheetCsv({ csv, actor: 'manual:nick' });
  return NextResponse.json(result);
}

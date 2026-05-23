// Reads the local sweep output (data/slack-channels.json, produced by
// `npm run sweep:slack`) and runs it through the same exact-match +
// fuzzy-near-match pipeline the HAR upload uses. This is the
// "automated" path — once the sweep script has been run and produced
// the file, a single click here promotes everything.
//
// We deliberately keep the sweep output as a file rather than POSTing
// it from the script directly so that:
//   1. The sweep can be re-run / inspected / cached without re-doing
//      the discovery work.
//   2. The script has no dependency on the web app being up.
//   3. There's a single canonical artifact (data/slack-channels.json)
//      that we can also git-ignore and rotate independently.
//
// POST /api/slack/mappings/promote-from-sweep
//   no body required
// Returns: PromoteFromPasteResult (shared shape with HAR + paste flows)

import { NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promoteFromPaste } from '@/lib/slack-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Next.js typically runs from apps/web, but the dev script can also
// start from the repo root depending on invocation. Probe both.
// (Same shape as apps/web/src/app/api/ctas/generate/route.ts.)
function resolveSweepFile(): string {
  const candidates = [
    resolve(process.cwd(), '../../data/slack-channels.json'),
    resolve(process.cwd(), 'data/slack-channels.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!; // for the error message; stat will fail and we'll report it
}

export async function POST(): Promise<Response> {
  const sweepFile = resolveSweepFile();
  let stats;
  try {
    stats = await stat(sweepFile);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Sweep file not found at ${sweepFile}. ` +
          `Run \`npm run sweep:slack\` (from the repo root) first — it will ` +
          `prompt you to log into Slack via SSO the first time, then save ` +
          `the channel directory to data/slack-channels.json.`,
      },
      { status: 404 },
    );
  }

  const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
  let raw: string;
  try {
    raw = await readFile(sweepFile, 'utf8');
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not read sweep file: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // Sweep file shape: { ok: true, ranAt, channels: [...] }.
  // parseChannelPaste already handles $.channels, so we feed it the raw
  // file contents directly — no shape translation needed.
  const result = await promoteFromPaste({ paste: raw, actor: 'manual:nick' });

  return NextResponse.json(
    {
      ...result,
      sweepFile: {
        path: sweepFile,
        ranAt: stats.mtime.toISOString(),
        ageDays: Math.round(ageDays * 10) / 10,
        sizeBytes: stats.size,
      },
    },
    { status: result.parseError ? 400 : 200 },
  );
}

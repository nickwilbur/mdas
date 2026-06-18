// Server-only Glean briefs for "ML Override ≠ Best Case" renewals.
import 'server-only';
import { gleanForRequest, type GleanClient } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type {
  MlOverrideMismatchContext,
  MlOverrideMismatchEnrichment,
} from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';
import {
  buildMlOverrideMismatchPrompt,
  parseMlOverrideMismatchEnrichment,
} from './forecast-ml-override-mismatch-core';

const CONCURRENCY = 4;

function unavailable(reason: string | undefined): MlOverrideMismatchEnrichment {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return {
    headline: '',
    customerContext: '',
    unavailableReason: cleaned || 'Glean call failed',
  };
}

export async function generateMlOverrideMismatchContext(
  req: Request,
  contexts: MlOverrideMismatchContext[],
  asOfDate: string,
  quarterLabel: string,
  sharedClient?: GleanClient,
): Promise<Record<string, MlOverrideMismatchEnrichment>> {
  if (contexts.length === 0) return {};

  let client: GleanClient;
  try {
    client = sharedClient ?? (await gleanForRequest(req)).client;
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const fail = unavailable(message);
    return Object.fromEntries(contexts.map((c) => [c.opportunityId, fail]));
  }

  const out: Record<string, MlOverrideMismatchEnrichment> = {};
  const queue = [...contexts];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const ctx = queue.shift();
          if (!ctx) return;
          out[ctx.opportunityId] = await runOne(
            client,
            ctx,
            asOfDate,
            quarterLabel,
          );
        }
      })(),
    );
  }
  await Promise.all(workers);

  for (const id of Object.keys(out)) {
    const enr = out[id]!;
    if (!enr.headline && !enr.customerContext && !enr.unavailableReason) {
      delete out[id];
    }
  }
  return out;
}

async function runOne(
  client: GleanClient,
  ctx: MlOverrideMismatchContext,
  asOfDate: string,
  quarterLabel: string,
): Promise<MlOverrideMismatchEnrichment> {
  try {
    const prompt = buildMlOverrideMismatchPrompt(ctx, asOfDate, quarterLabel);
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = cleanGleanChatReply(reply.text);
    if (!text) return unavailable('empty reply from Glean chat');

    const parsed = parseMlOverrideMismatchEnrichment(text);
    if (!parsed) return unavailable('Glean returned no parseable brief');

    return parsed;
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.mlOverrideMismatch.glean_failed', {
      opportunityId: ctx.opportunityId,
      accountName: ctx.accountName,
      asOfDate,
      message,
    });
    return unavailable(message);
  }
}

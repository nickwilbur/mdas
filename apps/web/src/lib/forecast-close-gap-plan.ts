// Server-only "Accounts to Close Gap" action-plan generator.
//
// For each account that appears in the "Accounts to Close Gap" section
// of the quarterly churn-forecast script, asks Glean Adaptive chat for
// a short action checklist. Every step is owned by the account's
// current Assigned CSE from Salesforce (`Assigned_CSE__c`) — NOT the
// opp-level Sales Engineer, Account Owner, or names Glean finds in old
// Slack / notes (those frequently reference former employees).
//
// Mirrors `forecast-account-context.ts`: the web route runs the calls,
// builds a Record<accountId, CloseGapActionPlan>, and hands it to the
// pure renderer, which splices the checklist inline beneath the bullet.
//
// Failure mode: per the house convention, a failed account gets a plan
// carrying `unavailableReason` so the renderer emits a stale-marker and
// the manager knows to write the plan themselves before the leadership
// call.
//
// Cost shape: bounded to ≤5 accounts per quarter (top 3 red + 2 yellow
// by ATR), ≤10 across both quarters. Calls run in parallel with a
// modest concurrency cap so a slow upstream account doesn't pin the
// wall-clock and one transient failure doesn't poison the batch.
import 'server-only';
import { gleanForRequest } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type {
  CloseGapAccountContext,
  CloseGapActionPlan,
} from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';
import {
  buildCloseGapActionPlanPrompt,
  parseCloseGapActionSteps,
} from './forecast-close-gap-plan-core';

const CONCURRENCY = 4;

function unavailable(reason: string | undefined): CloseGapActionPlan {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return { steps: [], unavailableReason: cleaned || 'Glean call failed' };
}

/**
 * Generate action plans for a set of Close-Gap accounts, in parallel
 * with bounded concurrency. Returns a Record<accountId,
 * CloseGapActionPlan> ready to pass as
 * `ForecastInput.closeGapActionPlans`.
 *
 * Per-account failures become a stale-marker plan on that account
 * only; the rest of the batch still resolves. An empty `contexts`
 * input yields an empty map (no Glean call).
 */
export async function generateCloseGapActionPlans(
  req: Request,
  contexts: CloseGapAccountContext[],
  asOfDate: string,
  quarterLabel: string,
): Promise<Record<string, CloseGapActionPlan>> {
  if (contexts.length === 0) return {};

  let glean: Awaited<ReturnType<typeof gleanForRequest>>;
  try {
    glean = await gleanForRequest(req);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const marker = unavailable(message);
    return Object.fromEntries(contexts.map((c) => [c.accountId, marker]));
  }

  const out: Record<string, CloseGapActionPlan> = {};
  const queue = [...contexts];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const ctx = queue.shift();
          if (!ctx) return;
          out[ctx.accountId] = await runOneAccount(
            glean.client,
            ctx,
            asOfDate,
            quarterLabel,
          );
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

async function runOneAccount(
  client: Awaited<ReturnType<typeof gleanForRequest>>['client'],
  ctx: CloseGapAccountContext,
  asOfDate: string,
  quarterLabel: string,
): Promise<CloseGapActionPlan> {
  try {
    const prompt = buildCloseGapActionPlanPrompt(ctx, asOfDate, quarterLabel);
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = cleanGleanChatReply(reply.text);
    if (!text) return unavailable('empty reply from Glean chat');
    const steps = parseCloseGapActionSteps(text, ctx);
    if (!steps) return unavailable('Glean returned no parseable action plan');
    return { steps };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.closeGapActionPlan.glean_failed', {
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      asOfDate,
      message,
    });
    return unavailable(message);
  }
}

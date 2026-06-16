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
import {
  closeGapPrimaryOwner,
  type CloseGapAccountContext,
  type CloseGapActionPlan,
} from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';
import {
  MAX_CLOSE_GAP_ACTION_CHARS,
  MAX_CLOSE_GAP_STEPS,
  parseCloseGapActionSteps,
} from './forecast-close-gap-plan-core';

const CONCURRENCY = 4;

function unavailable(reason: string | undefined): CloseGapActionPlan {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return { steps: [], unavailableReason: cleaned || 'Glean call failed' };
}

/**
 * Build the per-account action-plan prompt. Grounds Glean in the same
 * structured facts the manager scans plus the named internal owners,
 * then asks for a strict JSON array of {owner, action} steps. The
 * owner of each step MUST be one of the named internal owners so the
 * leadership read has real accountability, not "the team".
 */
function buildPrompt(
  ctx: CloseGapAccountContext,
  asOfDate: string,
  quarterLabel: string,
): string {
  const bandPhrase =
    ctx.band === 'red'
      ? 'a RED-band churn-save renewal (risk trending the wrong way)'
      : 'a YELLOW-band churn-save renewal (need to add hedge / compress risk)';

  const primaryOwner = closeGapPrimaryOwner(ctx);

  const facts: string[] = [];
  if (ctx.cerebroRiskCategory) facts.push(`Cerebro Risk: ${ctx.cerebroRiskCategory}`);
  if (ctx.cseSentiment) facts.push(`CSE Sentiment: ${ctx.cseSentiment}`);
  facts.push(`Renewal close date: ${ctx.closeDate}`);
  facts.push(`ATR exposed: $${Math.round(ctx.atrUSD).toLocaleString('en-US')}`);
  if (ctx.forecastMostLikelyUSD != null) {
    const sign = ctx.forecastMostLikelyUSD >= 0 ? '+' : '-';
    facts.push(
      `Forecast Most Likely: ${sign}$${Math.abs(Math.round(ctx.forecastMostLikelyUSD)).toLocaleString('en-US')}`,
    );
  }
  if (ctx.scNextSteps) facts.push(`Rep's logged next steps: ${ctx.scNextSteps.slice(0, 400)}`);

  return [
    `You are a Zuora Customer Success Executive (CSE) manager preparing the weekly Expand 3 churn-call. This account is in the "Accounts to Close Gap" section — i.e. dollars we need to recover to close the gap from Total Churn/Downsell risk to Flash. Your job is to produce a SHORT, concrete action plan: who does what next to close the gap on this renewal.`,
    ``,
    `ACCOUNT: ${ctx.accountName}`,
    `STATUS: ${bandPhrase}`,
    `QUARTER: ${quarterLabel} (as of ${asOfDate})`,
    ``,
    `ACTION OWNER — every step is owned by the account's Assigned CSE (from Salesforce, as of ${asOfDate}):`,
    primaryOwner !== 'Assigned CSE'
      ? `  ${primaryOwner}`
      : `  (not set in Salesforce — use "Assigned CSE" in the owner field)`,
    ``,
    `CRITICAL — owner assignment rules:`,
    `  - Use ONLY the Assigned CSE above for every step's "owner" field — same name on every line.`,
    `  - Do NOT use Sales Engineers, Account Owners, or anyone named in Slack / Gainsight / meeting notes — those are often former employees or stale opp assignments.`,
    `  - Do NOT use Salesforce User Ids (005…).`,
    ``,
    `STRUCTURED FACTS:`,
    ...facts.map((f) => `  - ${f}`),
    ``,
    `WHAT TO SEARCH for the soft context that shapes the plan:`,
    `  - Slack threads about the account (churn-talk, escalations, exec involvement, blocked renewal)`,
    `  - Gmail threads with the customer's procurement / champion / exec sponsor`,
    `  - Account plans and CSE notes in Gainsight / Salesforce`,
    `  - Meeting transcripts from Zoom / Gong with this customer`,
    ``,
    `OUTPUT FORMAT — strict JSON array, no markdown, no preamble. 2–${MAX_CLOSE_GAP_STEPS} steps, ordered by leverage (highest-impact action first). Each step:`,
    `  {"owner": "${primaryOwner}", "action": "<concrete next move, ≤${MAX_CLOSE_GAP_ACTION_CHARS} chars, ideally with a timeframe>"}`,
    ``,
    `Example shape (note: same owner on every line):`,
    `[`,
    `  {"owner": "${primaryOwner}", "action": "Schedule exec sponsor call by 6/5 to address the CFO's 30% discount ask surfaced in Slack."},`,
    `  {"owner": "${primaryOwner}", "action": "Deliver value-realization recap tying usage growth to renewal ROI before procurement review."}`,
    `]`,
    ``,
    `Ground each action in a real signal where possible (Slack, email, account plan, meeting) but do NOT cite URLs, do NOT invent details, and do NOT use note authors as the "owner". Reply with ONLY the JSON array.`,
  ].join('\n');
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
    const prompt = buildPrompt(ctx, asOfDate, quarterLabel);
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

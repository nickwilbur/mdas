// Server-only Key Saves per-account context generator.
//
// For each account that will appear in the Key Saves bullets of the
// quarterly churn-forecast script (red / yellow / green sub-lists),
// asks Glean Adaptive chat for a 1–2 sentence qualitative "why this
// renewal is on the list" blurb. The structured chip line
// (Risk / Sentiment / Renewal / ML / scNextSteps) already gives
// leadership the facts; this call layers the *narrative* on top —
// what Slack threads, exec emails, account-plan updates, CSE notes,
// and meeting transcripts say about the live save motion.
//
// Mirrors the architecture of `forecast-narrative.ts` (Health
// Snapshot): web route runs the calls, builds a Record<accountId,
// string>, and hands it to the pure renderer. The renderer treats
// the map as opaque text and splices it onto the bullet.
//
// Failure mode: per 2026-05-21 user feedback, render a stale-marker
// `[Glean context unavailable — <reason>]` so the manager sees that
// they need to write the why themselves before pasting into the
// leadership call. Same convention as `forecast-narrative.ts`.
//
// Cost shape: bounded to ≤15 distinct accounts per forecast (5 red +
// 5 yellow + 5 green, deduped). Calls are run in parallel with a
// modest concurrency limit so a slow upstream account doesn't pin
// the wall-clock and a transient failure on one doesn't poison the
// others. Glean's MCP chat tool is rate-limited gently and 15
// parallel asks is well within tolerance in observed runs.
import 'server-only';
import { gleanForRequest } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type { KeySaveAccountContext } from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';

const FAILURE_MARKER_PREFIX = '[Glean context unavailable';
const CONCURRENCY = 4;
const MAX_BLURB_CHARS = 280;

function failureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `${FAILURE_MARKER_PREFIX} — ${cleaned}]`
    : `${FAILURE_MARKER_PREFIX}]`;
}

/**
 * Build the per-account Glean prompt. Grounds the model in the
 * structured facts the manager already scans (so the model isn't
 * inventing risk from a blank page) and explicitly asks for the
 * Slack / Gmail / account-plan / CSE-notes / meeting-transcript
 * narrative the structured fields can't carry.
 *
 * Hard length cap is enforced both in the prompt (model instruction)
 * and post-hoc by truncation, because models drift on length.
 */
function buildAccountPrompt(
  ctx: KeySaveAccountContext,
  asOfDate: string,
  quarterLabel: string,
): string {
  const bandPhrase =
    ctx.band === 'red'
      ? 'a RED-band churn-save target (risk trending the wrong way)'
      : ctx.band === 'yellow'
        ? 'a YELLOW-band account where the team is trying to add hedge to the line'
        : 'a GREEN-band account where the existing hedge needs to be captured';
  const facts: string[] = [];
  if (ctx.cerebroRiskCategory) facts.push(`Cerebro Risk: ${ctx.cerebroRiskCategory}`);
  if (ctx.cseSentiment) facts.push(`CSE Sentiment: ${ctx.cseSentiment}`);
  facts.push(`Renewal close date: ${ctx.closeDate}`);
  if (ctx.acvUSD != null) facts.push(`ACV: $${Math.round(ctx.acvUSD).toLocaleString('en-US')}`);
  if (ctx.forecastMostLikelyUSD != null) {
    const sign = ctx.forecastMostLikelyUSD >= 0 ? '+' : '-';
    facts.push(
      `Forecast Most Likely: ${sign}$${Math.abs(Math.round(ctx.forecastMostLikelyUSD)).toLocaleString('en-US')}`,
    );
  }
  if (ctx.scNextSteps) facts.push(`Rep's logged next steps: ${ctx.scNextSteps.slice(0, 400)}`);

  return [
    `You are a Zuora Customer Success Executive (CSE) manager preparing the weekly Expand 3 churn-call drill-in. The script already includes a one-line structured chip for each account (Risk / Sentiment / Renewal date / Forecast ML / rep's next step). Your job is to add ONE qualitative "why is this on the list?" sentence — the soft context the chip line can't carry.`,
    ``,
    `ACCOUNT: ${ctx.accountName}`,
    `STATUS: ${bandPhrase}`,
    `QUARTER: ${quarterLabel} (as of ${asOfDate})`,
    `STRUCTURED FACTS (already in the script — do NOT restate verbatim):`,
    ...facts.map((f) => `  - ${f}`),
    ``,
    `WHAT TO SEARCH:`,
    `  - Slack messages mentioning the account (churn-talk, escalations, exec involvement)`,
    `  - Gmail threads with the customer's procurement / champion / exec sponsor`,
    `  - Account plans and CSE notes in Gainsight / Salesforce`,
    `  - Meeting transcripts from Zoom / Gong with this customer`,
    `  - Recent design-doc / RFC mentions`,
    ``,
    `WRITE: exactly 1–2 plaintext sentences (no bullets, no markdown, ≤${MAX_BLURB_CHARS} chars total) that synthesize the soft context. Lead with the most actionable item (live escalation, exec engagement, contract restructure in flight, blocking integration issue, etc.). If Glean has no signal beyond what's already in the structured facts, reply with the single word "NONE" and nothing else — we will then omit the Glean tail rather than render filler. Do NOT invent details; only summarize what's actually surfaced.`,
    ``,
    `Reply with ONLY the 1–2 sentences (or the single word NONE). No preamble, no signoff, no markdown, no citations.`,
  ].join('\n');
}

/**
 * Run the per-account enrichment in parallel with bounded
 * concurrency. Returns a Record<accountId, blurb> ready to pass as
 * `ForecastInput.accountContext`.
 *
 * Per-account failures become a stale-marker on that account only;
 * other accounts in the batch still resolve.
 *
 * `NONE` replies (model says "no soft signal beyond the structured
 * facts") are dropped — we render the bullet without a Glean tail
 * rather than show filler. This keeps the script signal-dense.
 */
export async function generateAccountContext(
  req: Request,
  contexts: KeySaveAccountContext[],
  asOfDate: string,
  quarterLabel: string,
): Promise<Record<string, string>> {
  if (contexts.length === 0) return {};

  let glean: Awaited<ReturnType<typeof gleanForRequest>>;
  try {
    glean = await gleanForRequest(req);
  } catch (err) {
    // No client at all — credentials missing, request not authed,
    // etc. Every account gets the same stale marker so the manager
    // sees the systemic failure exactly once per account on the
    // pasted script.
    const message = (err as Error)?.message ?? String(err);
    const marker = failureMarker(message);
    return Object.fromEntries(contexts.map((c) => [c.accountId, marker]));
  }

  const out: Record<string, string> = {};
  // Simple promise-pool: dequeue from the front, run up to CONCURRENCY
  // at a time. Beats a flat Promise.all() because we want to shield
  // Glean from a thundering herd of 15 simultaneous chat sessions.
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

  // Strip dropped NONE entries from the final map so the renderer
  // emits those bullets without a Glean tail. We do this AFTER the
  // pool resolves so the in-flight book-keeping stays simple.
  for (const id of Object.keys(out)) {
    if (out[id] === '') delete out[id];
  }
  return out;
}

async function runOneAccount(
  client: Awaited<ReturnType<typeof gleanForRequest>>['client'],
  ctx: KeySaveAccountContext,
  asOfDate: string,
  quarterLabel: string,
): Promise<string> {
  try {
    const prompt = buildAccountPrompt(ctx, asOfDate, quarterLabel);
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = cleanGleanChatReply(reply.text);
    if (!text) return failureMarker('empty reply from Glean chat');
    // Model said "no signal" — render the bullet without a Glean
    // tail. The empty string is the sentinel; the caller drops these
    // keys before handing the map to the renderer.
    if (/^none\.?$/i.test(text.trim())) return '';
    // Belt-and-suspenders length cap. The prompt asks for ≤280 chars
    // but models drift. Truncate at a word boundary to keep the
    // bullet readable on a live call.
    if (text.length <= MAX_BLURB_CHARS) return text;
    const slice = text.slice(0, MAX_BLURB_CHARS);
    const lastSpace = slice.lastIndexOf(' ');
    const cutAt = lastSpace > MAX_BLURB_CHARS * 0.7 ? lastSpace : MAX_BLURB_CHARS;
    return slice.slice(0, cutAt).trimEnd() + '…';
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.accountContext.glean_failed', {
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      asOfDate,
      message,
    });
    return failureMarker(message);
  }
}

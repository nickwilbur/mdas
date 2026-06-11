// Server-only Glean context for "ML Override ≠ Best Case" renewals.
//
// When a renewal's CSE `forecastMostLikelyOverride` materially diverges
// from Salesforce `bestCaseUSD`, leadership needs to know WHY — not an
// action plan, but qualitative risk context (Slack, Gainsight, notes,
// meetings) explaining the gap and any additive risk indicators.
import 'server-only';
import { gleanForRequest } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type { MlOverrideMismatchContext } from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';
import { sanitizeMlMismatchContext } from './sanitize-forecast-context';

const CONCURRENCY = 4;
const MAX_CONTEXT_CHARS = 320;
const FAILURE_MARKER_PREFIX = '[Glean context unavailable';

function failureMarker(reason: string | undefined): string {
  const cleaned = (reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return cleaned
    ? `${FAILURE_MARKER_PREFIX} — ${cleaned}]`
    : `${FAILURE_MARKER_PREFIX}]`;
}

function gapDirectionPhrase(gapUSD: number): string {
  if (gapUSD < 0) {
    return 'the CSE ML Override is MORE pessimistic than Best Case (larger loss / smaller save)';
  }
  if (gapUSD > 0) {
    return 'the CSE ML Override is MORE optimistic than Best Case';
  }
  return 'ML Override and Best Case diverge';
}

function buildPrompt(
  ctx: MlOverrideMismatchContext,
  asOfDate: string,
  quarterLabel: string,
): string {
  const facts: string[] = [
    `ML Override: ${fmtSigned(ctx.mlOverrideUSD)}`,
    `Best Case: ${fmtSigned(ctx.bestCaseUSD)}`,
    `Gap (Override − Best Case): ${fmtSigned(ctx.gapUSD)} — ${gapDirectionPhrase(ctx.gapUSD)}`,
    `Renewal close date: ${ctx.closeDate}`,
  ];
  if (ctx.forecastMostLikelyUSD != null) {
    facts.push(`System Forecast ML: ${fmtSigned(ctx.forecastMostLikelyUSD)}`);
  }
  if (ctx.forecastCategory) facts.push(`Forecast category: ${ctx.forecastCategory}`);
  if (ctx.cerebroRiskCategory) facts.push(`Cerebro Risk: ${ctx.cerebroRiskCategory}`);
  if (ctx.cseSentiment) facts.push(`CSE Sentiment: ${ctx.cseSentiment}`);
  if (ctx.assignedCseName) facts.push(`Assigned CSE: ${ctx.assignedCseName}`);

  return [
    `You are a Zuora Customer Success Executive (CSE) manager preparing the weekly Expand 3 churn-call. This renewal is flagged because the CSE's Forecast Most Likely OVERRIDE on the opportunity does NOT match the opportunity's Best Case USD in Salesforce — leadership wants to understand WHY and what additional risk that gap signals.`,
    ``,
    `ACCOUNT: ${ctx.accountName}`,
    `OPPORTUNITY: ${ctx.opportunityName}`,
    `QUARTER: ${quarterLabel} (as of ${asOfDate})`,
    ``,
    `STRUCTURED FACTS (already in the script — do NOT restate verbatim):`,
    ...facts.map((f) => `  - ${f}`),
    ``,
    `WHAT TO SEARCH:`,
    `  - Slack / Gmail on this account discussing forecast changes, downsell risk, hedge, or save assumptions`,
    `  - Gainsight / Salesforce CSE notes, FLM notes, sentiment commentary`,
    `  - Meeting transcripts where forecast, pricing, or renewal scope was discussed`,
    ``,
    `WRITE: 1–3 plaintext sentences (no bullets, no markdown, no line breaks, ≤${MAX_CONTEXT_CHARS} chars) as a manager briefing leadership. State conclusions declaratively, grounded in source type + fact:`,
    `  1) WHY the CSE override diverges from Best Case (known churn, pricing pushback, scope cut, low engagement, etc.)`,
    `  2) Additive risk indicators from soft signals (escalation, exec disengagement, competitor, stalled save motion)`,
    ``,
    `VOICE — authoritative, not speculative:`,
    `  - USE: "Gainsight records…", "CSE notes cite…", "Slack documents…", "Meeting transcript shows…", "Salesforce FLM notes state…"`,
    `  - FORBIDDEN: likely, appears, seems, might, may, possibly, suggests, probably, "I found", "we found", "it looks like"`,
    `  - Do NOT write in first person as the AI ("I", "we" discovering something). Write as operational fact.`,
    `Do NOT write an action plan or owner assignments. If Glean has no signal beyond the structured facts, reply with the single word "NONE". Do NOT invent details.`,
    ``,
    `Reply with ONLY the 1–3 sentences (or the single word NONE). No preamble, no markdown, no citations.`,
  ].join('\n');
}

function fmtSigned(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
}

export async function generateMlOverrideMismatchContext(
  req: Request,
  contexts: MlOverrideMismatchContext[],
  asOfDate: string,
  quarterLabel: string,
): Promise<Record<string, string>> {
  if (contexts.length === 0) return {};

  let glean: Awaited<ReturnType<typeof gleanForRequest>>;
  try {
    glean = await gleanForRequest(req);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const marker = failureMarker(message);
    return Object.fromEntries(contexts.map((c) => [c.opportunityId, marker]));
  }

  const out: Record<string, string> = {};
  const queue = [...contexts];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const ctx = queue.shift();
          if (!ctx) return;
          out[ctx.opportunityId] = await runOne(
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

  for (const id of Object.keys(out)) {
    if (out[id] === '') delete out[id];
  }
  return out;
}

async function runOne(
  client: Awaited<ReturnType<typeof gleanForRequest>>['client'],
  ctx: MlOverrideMismatchContext,
  asOfDate: string,
  quarterLabel: string,
): Promise<string> {
  try {
    const prompt = buildPrompt(ctx, asOfDate, quarterLabel);
    const messages: GleanChatRequestMessage[] = [
      { author: 'USER', fragments: [{ text: prompt }] },
    ];
    const reply = await client.chat({ messages, stream: false });
    const text = cleanGleanChatReply(reply.text);
    if (!text) return failureMarker('empty reply from Glean chat');
    if (/^none\.?$/i.test(text.trim())) return '';
    const sanitized = sanitizeMlMismatchContext(text);
    if (!sanitized) return failureMarker('empty reply after sanitization');
    if (sanitized.length <= MAX_CONTEXT_CHARS) return sanitized;
    const slice = sanitized.slice(0, MAX_CONTEXT_CHARS);
    const lastSpace = slice.lastIndexOf(' ');
    const cutAt = lastSpace > MAX_CONTEXT_CHARS * 0.7 ? lastSpace : MAX_CONTEXT_CHARS;
    return slice.slice(0, cutAt).trimEnd() + '…';
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // eslint-disable-next-line no-console
    console.warn('forecast.mlOverrideMismatch.glean_failed', {
      opportunityId: ctx.opportunityId,
      accountName: ctx.accountName,
      asOfDate,
      message,
    });
    return failureMarker(message);
  }
}

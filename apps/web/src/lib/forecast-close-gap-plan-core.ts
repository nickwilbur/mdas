/**
 * Pure Close-Gap action-plan prompt builder + Glean response parser.
 *
 * Kept separate from the server-only Glean orchestrator so prompt
 * construction and JSON parsing can be unit-tested without IO.
 */
import {
  closeGapPrimaryOwner,
  resolveCloseGapOwner,
  type CloseGapAccountContext,
  type CloseGapActionStep,
} from '@mdas/forecast-generator';

export const MAX_CLOSE_GAP_STEPS = 4;
export const MAX_CLOSE_GAP_ACTION_CHARS = 180;
export const MAX_CLOSE_GAP_OWNER_CHARS = 80;

function cap(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '…';
}

/** Build the per-account action-plan prompt for Glean Adaptive chat. */
export function buildCloseGapActionPlanPrompt(
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
 * Parse one account's Glean reply into owner→action steps. Stamps every
 * step with the account's Assigned CSE regardless of Glean's owner field.
 */
export function parseCloseGapActionSteps(
  raw: string,
  ctx: CloseGapAccountContext,
): CloseGapActionStep[] | null {
  let payload = raw.trim();
  const fence = payload.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fence) payload = fence[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: CloseGapActionStep[] = [];
  for (const entry of parsed) {
    if (out.length >= MAX_CLOSE_GAP_STEPS) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { owner?: unknown; action?: unknown };
    if (typeof e.action !== 'string') continue;
    const action = e.action.trim();
    if (!action) continue;
    const ownerRaw = typeof e.owner === 'string' ? e.owner.trim() : '';
    const owner = cap(
      resolveCloseGapOwner(ownerRaw, ctx),
      MAX_CLOSE_GAP_OWNER_CHARS,
    );
    out.push({
      owner,
      action: cap(action, MAX_CLOSE_GAP_ACTION_CHARS),
    });
  }
  return out.length > 0 ? out : null;
}

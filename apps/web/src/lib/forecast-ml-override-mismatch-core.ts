/**
 * Pure ML Override ≠ Best Case brief builder + parser.
 *
 * Constants, prompt, and response parsing live together so prompt
 * construction cannot reference imports that were split into another
 * file (the original MAX_HEADLINE_CHARS ReferenceError).
 */
import type {
  MlOverrideMismatchContext,
  MlOverrideMismatchEnrichment,
} from '@mdas/forecast-generator';
import { sanitizeMlMismatchContext } from './sanitize-forecast-context';

export const MAX_HEADLINE_CHARS = 120;
export const MAX_COMMENTARY_CHARS = 280;
export const MAX_CUSTOMER_CONTEXT_CHARS = 520;

function truncateField(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cutAt = lastSpace > max * 0.7 ? lastSpace : max;
  return slice.slice(0, cutAt).trimEnd() + '…';
}

function fmtSigned(n: number): string {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
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

/** Build the Glean Adaptive chat prompt for one mismatch renewal. */
export function buildMlOverrideMismatchPrompt(
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
    facts.push(
      `Manager-effective Forecast ML: ${fmtSigned(ctx.forecastMostLikelyUSD)}`,
    );
  }
  if (ctx.forecastCategory) facts.push(`Forecast category: ${ctx.forecastCategory}`);
  if (ctx.cerebroRiskCategory) facts.push(`Cerebro Risk: ${ctx.cerebroRiskCategory}`);
  if (ctx.cseSentiment) facts.push(`CSE Sentiment: ${ctx.cseSentiment}`);
  if (ctx.accountOwnerName) facts.push(`Account Owner (AE): ${ctx.accountOwnerName}`);
  if (ctx.assignedCseName) facts.push(`Assigned CSE: ${ctx.assignedCseName}`);
  if (ctx.productLine) facts.push(`Product line: ${ctx.productLine}`);

  return [
    `You are a Zuora Customer Success Executive (CSE) manager preparing the weekly Expand 3 churn-call. This renewal is flagged because the CSE's Forecast Most Likely OVERRIDE on the opportunity does NOT match the opportunity's Best Case USD in Salesforce. Leadership needs a qualitative account brief — the same style as their churn-call playbook: a punchy headline, optional commentary on forecast posture, and a customer-context paragraph. Do NOT write an action plan or owner assignments.`,
    ``,
    `ACCOUNT: ${ctx.accountName}`,
    `OPPORTUNITY: ${ctx.opportunityName}`,
    `QUARTER: ${quarterLabel} (as of ${asOfDate})`,
    ``,
    `STRUCTURED FACTS (already in the script — do NOT restate verbatim in customerContext):`,
    ...facts.map((f) => `  - ${f}`),
    ``,
    `WHAT TO SEARCH:`,
    `  - Slack / Gmail on this account discussing forecast changes, downsell risk, hedge, or save assumptions`,
    `  - Gainsight / Salesforce CSE notes, FLM notes, sentiment commentary`,
    `  - Meeting transcripts where forecast, pricing, renewal scope, engagement, or competitor risk was discussed`,
    ``,
    `OUTPUT — strict JSON object, no markdown, no preamble:`,
    `{`,
    `  "headline": "<one-line pain headline, ≤${MAX_HEADLINE_CHARS} chars, e.g. 'Perch is a product fit problem' or 'Omnitracs is a combination of fit / performance / and implementation'>",`,
    `  "commentary": "<optional one sentence on forecast posture when AE/rep optimism diverges from the manager override, or empty string if not applicable>",`,
    `  "customerContext": "<2–4 sentences, ≤${MAX_CUSTOMER_CONTEXT_CHARS} chars, manager briefing prose explaining the real save/churn motion — engagement, product fit, pricing, competitor, utilization, exec sponsorship, etc.>"`,
    `}`,
    ``,
    `STYLE for customerContext — declarative manager voice:`,
    `  - USE: "The customer has said…", "The core issue is…", "This is a real save motion…", "Gainsight records…", "CSE notes cite…"`,
    `  - FORBIDDEN: likely, appears, seems, might, may, possibly, suggests, probably, "I found", "we found", "it looks like"`,
    `  - Do NOT write in first person as the AI. Do NOT invent details.`,
    `If Glean has no signal beyond the structured facts, reply with the single word NONE. Reply with ONLY the JSON object (or NONE).`,
  ].join('\n');
}

function enrichmentFromFields(fields: {
  headline: string;
  commentary?: string;
  customerContext: string;
}): MlOverrideMismatchEnrichment | null {
  const headline = fields.headline.trim();
  const customerContext = fields.customerContext.trim();
  if (!headline && !customerContext) return null;

  const resolvedHeadline =
    headline || truncateField(customerContext, MAX_HEADLINE_CHARS);

  return {
    headline: truncateField(resolvedHeadline, MAX_HEADLINE_CHARS),
    commentary: fields.commentary?.trim()
      ? truncateField(fields.commentary.trim(), MAX_COMMENTARY_CHARS)
      : undefined,
    customerContext: truncateField(
      customerContext || resolvedHeadline,
      MAX_CUSTOMER_CONTEXT_CHARS,
    ),
  };
}

function parseStructuredProse(text: string): MlOverrideMismatchEnrichment | null {
  const cleaned = sanitizeMlMismatchContext(text);
  if (cleaned.length < 24) return null;

  const headlineMatch = cleaned.match(
    /(?:^|\n)\s*headline:\s*(.+?)(?=\n\s*(?:commentary|customer context):|$)/i,
  );
  const commentaryMatch = cleaned.match(
    /(?:^|\n)\s*commentary:\s*(.+?)(?=\n\s*customer context:|$)/i,
  );
  const contextMatch = cleaned.match(
    /(?:^|\n)\s*customer context:\s*(.+)$/i,
  );

  if (headlineMatch || contextMatch) {
    return enrichmentFromFields({
      headline: headlineMatch?.[1] ?? '',
      commentary: commentaryMatch?.[1],
      customerContext: contextMatch?.[1] ?? cleaned,
    });
  }

  const firstSentence =
    cleaned.match(/^[^.!?]+[.!?]/)?.[0]?.trim() ??
    cleaned.slice(0, MAX_HEADLINE_CHARS);
  return enrichmentFromFields({
    headline: firstSentence.replace(/[.!?]+$/, ''),
    customerContext: cleaned,
  });
}

function parseJsonObject(raw: string): MlOverrideMismatchEnrichment | null {
  let text = raw.trim();
  if (/^none\.?$/i.test(text)) return null;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const brace = text.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      parsed = JSON.parse(brace[0]!);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  return enrichmentFromFields({
    headline:
      typeof obj.headline === 'string'
        ? sanitizeMlMismatchContext(obj.headline)
        : '',
    commentary:
      typeof obj.commentary === 'string'
        ? sanitizeMlMismatchContext(obj.commentary)
        : undefined,
    customerContext:
      typeof obj.customerContext === 'string'
        ? sanitizeMlMismatchContext(obj.customerContext)
        : '',
  });
}

/** Parse Glean reply into a manager brief (JSON preferred, prose fallback). */
export function parseMlOverrideMismatchEnrichment(
  raw: string,
): MlOverrideMismatchEnrichment | null {
  return parseJsonObject(raw) ?? parseStructuredProse(raw);
}

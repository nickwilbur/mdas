// Server-only "Glean-flagged emerging risks" identifier.
//
// Given a bounded list of in-quarter Expand 3 accounts (the universe
// we already render in the script), asks Glean Adaptive chat:
// "of THESE accounts, which show soft churn-risk signals in Slack /
// Gmail / account plans / CSE notes / meeting transcripts that the
// structured Salesforce / Clari data has not yet captured?"
//
// The output is spliced into the "Churn-save targets not yet hedged
// in Clari" block as a sibling sub-section. The renderer dedupes
// against accounts that are already on the structured lists so
// Glean's job here is purely to surface the accounts the structured
// filter MISSED.
//
// Hallucination guard (2026-05-21): the prompt restricts Glean to a
// bounded set of accountId|name tuples and asks for a JSON envelope
// keyed by accountId. We parse strictly and drop any accountId the
// model returned that wasn't in the input set — a missed account is
// recoverable, an invented account on a leadership churn-call is
// not.
//
// Failure mode: stale marker so leadership sees that they need to
// write the section themselves before the call. Same convention as
// `forecast-narrative.ts` / `forecast-account-context.ts`.
import 'server-only';
import { gleanForRequest, type GleanClient } from './glean-server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import type { GleanFlaggedRisk } from '@mdas/forecast-generator';
import { cleanGleanChatReply } from './clean-glean-chat-reply';

const MAX_RATIONALE_CHARS = 240;
const MAX_FLAGGED_PER_QUARTER = 8;

export interface QuarterAccountUniverse {
  quarter: 'current' | 'next';
  fiscalQuarterLabel: string;
  /**
   * Bounded universe of accounts in this quarter we want Glean to
   * consider. Each entry includes the canonical accountId (used to
   * dedupe against structurally-flagged accounts in the renderer)
   * and a short list of accountId / accountName / hasStructuralFlag
   * so the prompt can ask Glean to ignore accounts already on the
   * structured list.
   */
  accounts: {
    accountId: string;
    accountName: string;
    /** True when this account already appears on the deterministic
     *  Confirmed Churn / Saveable / not-yet-hedged path — Glean is
     *  told NOT to surface these (they're already on the manager's
     *  read). */
    alreadyStructurallyFlagged: boolean;
  }[];
}

/**
 * Run the bounded identify call for both quarters. Returns a flat
 * list of GleanFlaggedRisk entries (with `quarter` tagging which
 * block each belongs to) ready to pass as
 * `ForecastInput.gleanFlaggedRisks`.
 *
 * On any failure of either quarter's call we return an empty array
 * for that quarter rather than throwing — the deterministic script
 * must still render. The caller (forecast route) logs the failure
 * so the on-call sees it in observability.
 */
export async function generateGleanFlaggedRisks(
  req: Request,
  universes: QuarterAccountUniverse[],
  asOfDate: string,
  sharedClient?: GleanClient,
): Promise<GleanFlaggedRisk[]> {
  if (universes.length === 0) return [];

  let client: GleanClient;
  try {
    client = sharedClient ?? (await gleanForRequest(req)).client;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('forecast.gleanFlaggedRisks.client_failed', {
      asOfDate,
      message: (err as Error)?.message ?? String(err),
    });
    return [];
  }

  const settled = await Promise.allSettled(
    universes.map((u) => runOneQuarter(client, u, asOfDate)),
  );
  const out: GleanFlaggedRisk[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      out.push(...r.value);
    } else {
      // eslint-disable-next-line no-console
      console.warn('forecast.gleanFlaggedRisks.quarter_failed', {
        quarter: universes[i]!.quarter,
        asOfDate,
        message: (r.reason as Error)?.message ?? String(r.reason),
      });
    }
  }
  return out;
}

async function runOneQuarter(
  client: GleanClient,
  universe: QuarterAccountUniverse,
  asOfDate: string,
): Promise<GleanFlaggedRisk[]> {
  // No candidate universe means nothing for Glean to consider.
  // Skipping the call also avoids burning rate-limit budget on a
  // guaranteed-empty answer.
  const candidates = universe.accounts.filter(
    (a) => !a.alreadyStructurallyFlagged,
  );
  if (candidates.length === 0) return [];

  const prompt = buildPrompt(universe, candidates, asOfDate);
  const messages: GleanChatRequestMessage[] = [
    { author: 'USER', fragments: [{ text: prompt }] },
  ];
  const reply = await client.chat({ messages, stream: false });
  const text = cleanGleanChatReply(reply.text);
  if (!text) return [];

  return parseAndValidate(text, universe);
}

function buildPrompt(
  universe: QuarterAccountUniverse,
  candidates: { accountId: string; accountName: string }[],
  asOfDate: string,
): string {
  const tableRows = candidates
    .map((c) => `  ${c.accountId} | ${c.accountName}`)
    .join('\n');

  return [
    `You are a Zuora Customer Success Executive (CSE) manager preparing the weekly Expand 3 churn-call. The deterministic Salesforce + Clari pipeline already surfaces accounts where renewals are forecast DOWN against ATR ("Churn-save targets not yet hedged in Clari"). Your job is to identify accounts in THIS bounded universe whose SOFT signals (Slack, Gmail, account plans, CSE notes, meeting transcripts, Gong / Zoom recordings) suggest a renewal save situation that the structured forecast hasn't picked up yet.`,
    ``,
    `QUARTER: ${universe.fiscalQuarterLabel} (as of ${asOfDate})`,
    ``,
    `BOUNDED ACCOUNT UNIVERSE (accountId | accountName) — you MUST only return accountIds from this list. Accounts already on the deterministic structured list have been excluded for you, so anything you return is by definition new context:`,
    tableRows,
    ``,
    `WHAT TO LOOK FOR:`,
    `  - Slack threads about the account discussing churn, downsell, escalation, exec involvement, or a deferred/blocked renewal`,
    `  - Gmail threads where the customer's procurement or champion has signaled budget pressure, alternative-vendor evaluations, or contract restructure requests`,
    `  - Account plans or CSE notes (Gainsight / Salesforce) noting risk that is not yet reflected in the SFDC ForecastMostLikely`,
    `  - Meeting transcripts where the customer expressed dissatisfaction, missed go-lives, or pricing pushback`,
    `  - Cross-functional escalations (CSM, support, AE, exec sponsor) on the account in the past ~30 days`,
    ``,
    `WHAT TO IGNORE:`,
    `  - Generic product noise that doesn't reference this account by name`,
    `  - Routine support tickets without escalation signal`,
    `  - Signals older than ~60 days (stale)`,
    `  - Anything that does NOT suggest a renewal save / downsell risk specifically`,
    ``,
    `OUTPUT FORMAT — strict JSON array, no markdown, no preamble. Each entry MUST use an accountId from the bounded universe above. Maximum ${MAX_FLAGGED_PER_QUARTER} entries; if you have nothing to surface, return [].`,
    ``,
    `Example shape:`,
    `[`,
    `  {"accountId": "0011A0000XYZ", "rationale": "Live Slack escalation thread #cs-acme this week — customer's CFO requested 30% discount as condition for renewal; AE pushing for exec sponsor call. Not yet in Forecast ML."},`,
    `  {"accountId": "0011A0000ABC", "rationale": "Procurement email Mon 5/19 flagging vendor consolidation review; CSE notes mention pilot with competitor."}`,
    `]`,
    ``,
    `Rationale must be 1–2 plaintext sentences, ≤${MAX_RATIONALE_CHARS} chars. Cite source TYPE (Slack, email, account plan, meeting) not URLs. Do NOT invent details. If you cannot ground a rationale in a specific surfaced artifact, leave the account out.`,
    ``,
    `Reply with ONLY the JSON array.`,
  ].join('\n');
}

/**
 * Strict parser + validator. JSON.parse the reply (after stripping a
 * surrounding markdown fence if the model added one despite the
 * prompt), validate each entry has a known accountId from the
 * bounded universe, and length-cap each rationale.
 *
 * Anything malformed → empty array. We prefer "no Glean-flagged
 * section" over "Glean section with bogus accounts" on the
 * leadership churn-call.
 */
function parseAndValidate(
  raw: string,
  universe: QuarterAccountUniverse,
): GleanFlaggedRisk[] {
  // Strip ``` fences if the model added them despite the prompt
  // asking for raw JSON.
  let payload = raw.trim();
  const fenceMatch = payload.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) payload = fenceMatch[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const universeById = new Map(
    universe.accounts.map((a) => [a.accountId, a.accountName]),
  );
  const out: GleanFlaggedRisk[] = [];
  for (const entry of parsed) {
    if (out.length >= MAX_FLAGGED_PER_QUARTER) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { accountId?: unknown; rationale?: unknown };
    if (typeof e.accountId !== 'string') continue;
    if (typeof e.rationale !== 'string') continue;
    const name = universeById.get(e.accountId);
    // Drop anything not in the bounded universe — this is the
    // hallucination guard. The model occasionally invents plausible-
    // looking accountIds when it has no signal; we must never paste
    // those into the leadership doc.
    if (!name) continue;
    const rationale = e.rationale.trim();
    if (rationale.length === 0) continue;
    const capped =
      rationale.length <= MAX_RATIONALE_CHARS
        ? rationale
        : rationale.slice(0, MAX_RATIONALE_CHARS).trimEnd() + '…';
    out.push({
      accountId: e.accountId,
      accountName: name,
      quarter: universe.quarter,
      rationale: capped,
    });
  }
  return out;
}

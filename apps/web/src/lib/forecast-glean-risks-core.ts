/**
 * Pure Glean-flagged emerging-risks parser.
 *
 * Extracted from `forecast-glean-risks.ts` so vitest can pin the
 * hallucination guard (drop unknown accountIds) and rationale caps
 * without mocking Glean.
 */
import type { GleanFlaggedRisk } from '@mdas/forecast-generator';

export const MAX_GLEAN_FLAGGED_PER_QUARTER = 8;
export const MAX_GLEAN_RATIONALE_CHARS = 240;

export interface QuarterAccountUniverse {
  quarter: 'current' | 'next';
  fiscalQuarterLabel: string;
  accounts: {
    accountId: string;
    accountName: string;
    alreadyStructurallyFlagged: boolean;
  }[];
}

/**
 * Strict parser + validator for one quarter's Glean reply. Strips
 * markdown fences, validates each entry against the bounded universe,
 * and length-caps rationales. Malformed or hallucinated accountIds are
 * dropped — we prefer no section over bogus accounts on the call.
 */
export function parseGleanFlaggedRisksResponse(
  raw: string,
  universe: QuarterAccountUniverse,
): GleanFlaggedRisk[] {
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
    if (out.length >= MAX_GLEAN_FLAGGED_PER_QUARTER) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { accountId?: unknown; rationale?: unknown };
    if (typeof e.accountId !== 'string') continue;
    if (typeof e.rationale !== 'string') continue;
    const name = universeById.get(e.accountId);
    if (!name) continue;
    const rationale = e.rationale.trim();
    if (rationale.length === 0) continue;
    const capped =
      rationale.length <= MAX_GLEAN_RATIONALE_CHARS
        ? rationale
        : rationale.slice(0, MAX_GLEAN_RATIONALE_CHARS).trimEnd() + '…';
    out.push({
      accountId: e.accountId,
      accountName: name,
      quarter: universe.quarter,
      rationale: capped,
    });
  }
  return out;
}

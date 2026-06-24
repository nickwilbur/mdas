/**
 * Pure Glean-flagged risk parser.
 *
 * Prompt construction and Glean calls live in the server-only wrapper;
 * this module holds JSON/fence parsing and the bounded-universe
 * hallucination guard so vitest can lock down reply shapes without
 * mocking the Glean client.
 */
import type { GleanFlaggedRisk } from '@mdas/forecast-generator';

export const MAX_GLEAN_FLAGGED_RATIONALE_CHARS = 240;
export const MAX_GLEAN_FLAGGED_PER_QUARTER = 8;

export interface GleanFlaggedRiskUniverse {
  quarter: 'current' | 'next';
  accounts: { accountId: string; accountName: string }[];
}

/**
 * Strict parser + validator. JSON.parse the reply (after stripping a
 * surrounding markdown fence if the model added one), validate each
 * entry has a known accountId from the bounded universe, and length-cap
 * each rationale.
 */
export function parseGleanFlaggedRisks(
  raw: string,
  universe: GleanFlaggedRiskUniverse,
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
      rationale.length <= MAX_GLEAN_FLAGGED_RATIONALE_CHARS
        ? rationale
        : rationale.slice(0, MAX_GLEAN_FLAGGED_RATIONALE_CHARS).trimEnd() + '…';
    out.push({
      accountId: e.accountId,
      accountName: name,
      quarter: universe.quarter,
      rationale: capped,
    });
  }
  return out;
}

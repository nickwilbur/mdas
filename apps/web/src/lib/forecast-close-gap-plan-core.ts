/**
 * Pure Close-Gap action-plan parser.
 *
 * Extracted from `forecast-close-gap-plan.ts` so vitest can pin the
 * JSON parsing, owner stamping, and field-length caps without mocking
 * Glean.
 */
import {
  resolveCloseGapOwner,
  type CloseGapAccountContext,
  type CloseGapActionStep,
} from '@mdas/forecast-generator';

export const MAX_CLOSE_GAP_STEPS = 4;
export const MAX_CLOSE_GAP_ACTION_CHARS = 180;
export const MAX_CLOSE_GAP_OWNER_CHARS = 80;

function capField(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '…';
}

/**
 * Strict parser + validator for one account's Glean reply. Drops a
 * surrounding markdown fence if present, parses JSON, keeps only
 * well-formed {owner, action} entries, caps step count and field
 * lengths. Returns null when nothing usable parsed.
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
    const owner = capField(
      resolveCloseGapOwner(ownerRaw, ctx),
      MAX_CLOSE_GAP_OWNER_CHARS,
    );
    out.push({
      owner,
      action: capField(action, MAX_CLOSE_GAP_ACTION_CHARS),
    });
  }
  return out.length > 0 ? out : null;
}

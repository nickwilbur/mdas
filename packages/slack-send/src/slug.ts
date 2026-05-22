// Account-name → Slack channel-name slug.
//
// Zuora's internal convention for customer-facing Slack channels is
// `cust-{slugified-account-name}`. Slack channel names must be:
//   - lowercase
//   - <= 80 chars total
//   - letters, digits, hyphens, underscores, periods only
//   - cannot start or end with a hyphen / underscore / period
//
// We aggressively strip corporate suffixes (Inc, LLC, Ltd, Corp, etc.)
// before slugifying because the channel-name convention drops them too
// — "Stenograph LLC" → `cust-stenograph`, not `cust-stenograph-llc`.
//
// This function is PURE — no I/O, no Slack API calls. It produces a
// CANDIDATE name; the caller never assumes the channel exists. The
// send gate continues to require a real channel id (Cxxx), so a
// heuristic-only mapping is non-sendable by construction.

const CORPORATE_SUFFIXES = [
  // Match the suffix at the end of the string, optionally preceded by a
  // comma or space. Order matters only loosely (longest variants first
  // to avoid e.g. "Co" eating "Corp").
  /,?\s+incorporated$/i,
  /,?\s+corporation$/i,
  /,?\s+limited$/i,
  /,?\s+holdings?$/i,
  /,?\s+company$/i,
  /,?\s+inc\.?$/i,
  /,?\s+llc\.?$/i,
  /,?\s+ltd\.?$/i,
  /,?\s+corp\.?$/i,
  /,?\s+co\.?$/i,
  /,?\s+plc\.?$/i,
  /,?\s+gmbh\.?$/i,
  /,?\s+ag\.?$/i,
  /,?\s+sa\.?$/i,
  /,?\s+nv\.?$/i,
  /,?\s+bv\.?$/i,
  /,?\s+pty\.?$/i,
];

// Also drop "fka …" / "dba …" / "(formerly …)" tails — they aren't part
// of the channel name. Stenograph's channel is `cust-stenograph`, not
// `cust-stenograph-fka-something`.
const TRAILING_NOISE = [
  /\s+fka\s+.*$/i,
  /\s+dba\s+.*$/i,
  /\s*\(formerly\s+[^)]+\)\s*$/i,
  /\s*\([^)]+\)\s*$/i, // any trailing parenthetical
];

const SLACK_NAME_MAX_LEN = 80;
const SLACK_CHANNEL_PREFIX = 'cust-';

export function slugifyAccountName(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  for (const re of TRAILING_NOISE) s = s.replace(re, '').trim();
  for (const re of CORPORATE_SUFFIXES) s = s.replace(re, '').trim();

  s = s.toLowerCase();
  // Replace any non-allowed char with a hyphen. Allowed: a-z, 0-9, _, .
  s = s.replace(/[^a-z0-9_.]+/g, '-');
  // Collapse repeated hyphens.
  s = s.replace(/-{2,}/g, '-');
  // Trim leading/trailing hyphens/underscores/periods.
  s = s.replace(/^[-_.]+|[-_.]+$/g, '');
  if (!s) return null;

  // Cap to Slack's 80-char limit accounting for the prefix.
  const maxBody = SLACK_NAME_MAX_LEN - SLACK_CHANNEL_PREFIX.length;
  if (s.length > maxBody) s = s.slice(0, maxBody).replace(/[-_.]+$/g, '');
  if (!s) return null;

  return SLACK_CHANNEL_PREFIX + s;
}

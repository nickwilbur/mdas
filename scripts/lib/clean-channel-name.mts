// Pure helper for cleaning Slack channel names scraped from the Slack
// web client's quick-switcher results.
//
// Slack renders each switcher row roughly like:
//
//   #cust-66degreesEnter…
//          ↑          ↑
//      channel name   right-aligned workspace badge label
//                     (CSS text-overflow:ellipsis truncates
//                     "Enterprise" → "Enter…", "External" →
//                     "Externa…", etc.)
//
// Visually the badge is separated by CSS margin / a flex gap, but in the
// DOM it's a sibling text node with no whitespace between it and the
// channel name. Naïvely concatenating `textContent` produces garbage like
// `cust-66degreesenter` (from "Enterprise" truncated to "Enter") or
// `cust-bamboohrenter`. Splitting on `\s` doesn't help because there's
// no whitespace.
//
// THE RULE
//
// Slack channel names are kebab-case, so the segments are always joined
// by `-`. The badge, in contrast, is glued on with NO separator and
// always starts with an uppercase letter in the original DOM (we have
// already lowercased by this point — but the position is what matters).
// So the distinguishing feature of a glued-on badge is: the badge token
// directly follows a lowercase letter or digit, NOT a hyphen.
//
// We therefore strip a trailing token from TRAILING_BADGES only when it
// is preceded by `[a-z0-9]`. That correctly:
//   - strips:    cust-66degrees|enter      → cust-66degrees
//   - strips:    cust-bamboohr|enter       → cust-bamboohr
//   - strips:    cust-acme|Enterprise      → cust-acme
//   - preserves: cust-acme-enter           (legitimate, badge follows `-`)
//   - preserves: cust-acme-enterprises     (legitimate)
//   - preserves: cust-externalize          (legitimate, "external" isn't at end)
//
// This is the single source of truth for the regex and lives here,
// separate from the Playwright script, so it can be unit-tested without
// launching a browser. The sweep script imports BADGE_REGEX_SOURCE and
// inlines it into its page.evaluate callback (which runs in the browser
// context and can't import this module).

// Right-aligned badge labels (and their CSS-ellipsified prefixes) that
// Slack glues to the end of a switcher row's text with no separator.
// Each entry must be the literal substring that appears in the DOM —
// e.g. "Enter" not "Enterprise…" — because we match against textContent
// which doesn't include the ellipsis character.
//
// Order matters: list longer variants before their shorter prefixes so
// the alternation tries the most specific match first.
export const TRAILING_BADGES = [
  'Enterprise',
  'External',
  'Archived',
  'Private',
  'Channel',
  'Shared',
  'Members',
  'Member',
  'Joined',
  // Ellipsified prefixes that Slack's narrow badge column actually
  // renders. These are added as we observe them in real DOM dumps.
  'Externa',
  'Extern',
  'Enter',
  'Archive',
  'Privat',
  'Membe',
  'Shar',
  'DM',
];

// Regex source — anchored at end-of-string, requires the badge to be
// preceded by a lowercase letter or digit (the camel-glued case). The
// preceding char is in a non-capturing lookbehind so we don't consume
// it. Case-insensitive matching is applied at compile time.
//
// We also accept end-of-string preceded by an uppercase letter (the
// original DOM before lowercasing): the badge starts with a capital
// while the channel name segment ends with a lowercase, so the boundary
// is unambiguous regardless of the case fold step's order.
export const BADGE_REGEX_SOURCE = `(?<=[a-z0-9])(?:${TRAILING_BADGES.join('|')})$`;

const BADGE_REGEX = new RegExp(BADGE_REGEX_SOURCE, 'i');

/**
 * Clean a channel name as scraped from a Slack switcher row.
 * - Strips leading `#`.
 * - Strips trailing whitespace.
 * - If whitespace-separated, takes only the first whitespace token
 *   (covers Slack layouts where the badge IS separated by a space).
 * - Strips a trailing badge label (Enterprise, External, etc.) that's
 *   directly glued onto the channel name (i.e., preceded by `[a-z0-9]`).
 * - Lowercases.
 * Returns `null` if the result is empty.
 */
export function cleanChannelName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^[#]+/, '');
  const firstToken = s.split(/\s+/)[0];
  if (firstToken) s = firstToken;
  // Strip stacked badges (e.g. "fooEnterpriseExternal" → "foo"). Bounded
  // to TRAILING_BADGES.length iterations because each pass removes at
  // least one badge or terminates.
  for (let i = 0; i < TRAILING_BADGES.length; i++) {
    const stripped = s.replace(BADGE_REGEX, '');
    if (stripped === s) break;
    s = stripped;
  }
  s = s.toLowerCase().trim();
  return s || null;
}

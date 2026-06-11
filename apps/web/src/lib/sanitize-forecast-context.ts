/**
 * Post-process Glean context for leadership-facing forecast sections.
 * Pure module (no server-only) so vitest can unit-test it.
 */

/** Collapse whitespace/newlines to a single line of prose. */
export function collapseContextWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip hedging / first-person discovery phrasing. Prompt forbids these;
 * this is belt-and-suspenders before paste.
 */
export function sanitizeMlMismatchContext(text: string): string {
  let t = collapseContextWhitespace(text);
  const leadingPatterns = [
    /^I found that\s+/i,
    /^I found\s+/i,
    /^We found that\s+/i,
    /^We found\s+/i,
    /^It appears that\s+/i,
    /^It appears\s+/i,
    /^This appears to\s+/i,
    /^This appears\s+/i,
    /^It seems that\s+/i,
    /^It seems\s+/i,
    /^This seems to\s+/i,
    /^It looks like\s+/i,
  ];
  for (const re of leadingPatterns) {
    t = t.replace(re, '');
  }
  // Hedging → declarative before blanket word removal.
  t = t.replace(/\bappears to be\b/gi, 'is');
  t = t.replace(/\bseems to be\b/gi, 'is');
  t = t.replace(/\bappears to\b/gi, '');
  t = t.replace(/\bseems to\b/gi, '');
  t = t.replace(/\b(likely|probably|possibly|might|may)\b/gi, '');
  return collapseContextWhitespace(t);
}

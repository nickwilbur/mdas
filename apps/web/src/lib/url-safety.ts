/**
 * Tiny URL-safety helpers used wherever the UI renders a link whose
 * `href` originates from a file on disk (CTA scan markdown, JSONL log).
 *
 * The current MDAS deployment treats those files as trusted, but they
 * are written by an external workflow (`scripts/generate-ctas.ts` +
 * Cascade) and are easy to tamper with. Hardening the render path
 * costs nothing and prevents `javascript:` / `data:` URLs from
 * sneaking into `<a href>` if the upstream pipeline is ever
 * compromised or buggy.
 */

/**
 * Returns the URL when it is an absolute http(s) URL, otherwise null.
 * Anything we cannot positively identify as a safe navigation target —
 * `javascript:`, `data:`, `vbscript:`, relative paths, empty strings —
 * is rejected. Query strings and fragments are preserved.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

/**
 * Validates a Salesforce object ID (15- or 18-char alphanumeric).
 * Used before interpolating an ID into a Lightning URL so a tampered
 * value can't produce a path-injection like `Account/..%2Flogout`.
 */
const SFDC_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export function isLikelySfdcId(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  return SFDC_ID_RE.test(raw.trim());
}

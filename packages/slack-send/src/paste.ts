// Channel-list extractor for browser-pasted Slack API responses.
//
// Used by the /admin/slack/import-channels page when the org has
// disabled conversations.list at the admin level (Zuora's case —
// `enterprise_is_restricted`). The operator opens Slack web, copies
// the response body of a known channel-list-bearing endpoint from
// DevTools (typically client.boot, client.counts, or users.conversations),
// and pastes it into our admin form. This module turns whatever shape
// they pasted into a uniform list of channels we can match against
// cust-{slug} heuristic candidates.
//
// Why a separate module: Slack's response shapes vary per endpoint
// and version, and this code needs to be defensive — pasted JSON may
// be slightly malformed (truncated, with leading "data:" prefix from
// some DevTools views, etc.). Concentrating the parsing here keeps
// the upstream call sites simple and the rules testable.
//
// We accept three shapes:
//
//   1. client.boot / client.counts:
//        { ok: true, channels: [{ id, name, is_archived?, is_private? }, ...] }
//      (channels may also be nested under .self.channels or similar
//       on older API versions — we look in a few common locations.)
//
//   2. users.conversations:
//        { ok: true, channels: [{ id, name, is_archived?, is_private? }, ...] }
//      Identical to (1) for our purposes.
//
//   3. Bare channels array:
//        [{ id: "Cxxx", name: "cust-acme" }, ...]
//      For when the operator already extracted the channels via a
//      console snippet and just pastes the array.
//
// Anything else returns an empty list with an explanation in `error`.

export interface PastedChannel {
  id: string;
  name: string;
  isArchived: boolean;
  isPrivate: boolean;
}

export interface PasteParseResult {
  channels: PastedChannel[];
  /** Where we found the channels in the pasted JSON (debugging aid). */
  sourcePath: string | null;
  /** Non-null on parse failure. */
  error: string | null;
}

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;

export function parseChannelPaste(raw: string): PasteParseResult {
  const empty = (error: string): PasteParseResult => ({
    channels: [],
    sourcePath: null,
    error,
  });

  if (!raw || typeof raw !== 'string') {
    return empty('Empty paste — paste the JSON response body from a Slack API call.');
  }

  // Strip common DevTools paste prefixes that operators sometimes
  // include by accident.
  let text = raw.trim();
  if (text.startsWith('data:')) text = text.slice(5).trim();
  // Strip a leading "Response" / "Preview" label if it slipped in.
  text = text.replace(/^(response|preview|body)[:\s]+/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return empty(
      `Could not parse as JSON: ${(e as Error).message}. ` +
        `Expected a Slack API response body (looks like { "ok": true, "channels": [...] }) ` +
        `or a bare channels array ([{ id, name }, ...]).`,
    );
  }

  // Walk a few known shapes to find the channels array.
  const candidatePaths: Array<{ path: string; get: (p: any) => unknown }> = [
    { path: '$.channels', get: (p) => p?.channels },
    { path: '$.self.channels', get: (p) => p?.self?.channels },
    { path: '$.data.channels', get: (p) => p?.data?.channels },
    // search.modules.channels returns { ok, module: 'channels', items: [...] }
    // where each item is a channel-like object (id, name, is_private, is_archived).
    { path: '$.items', get: (p) => p?.items },
    // client.counts returns { ok, channels: [{id, ...}], mpims: [...], ims: [...] }
    // — channels alone is what we want for cust-* matching; ims/mpims are DMs.
    { path: '$ (root array)', get: (p) => (Array.isArray(p) ? p : null) },
  ];

  let rawChannels: unknown = null;
  let sourcePath: string | null = null;
  for (const { path, get } of candidatePaths) {
    const v = get(parsed);
    if (Array.isArray(v) && v.length > 0) {
      rawChannels = v;
      sourcePath = path;
      break;
    }
  }

  if (!rawChannels) {
    // ok=false explicitly: pass the Slack error back so the operator
    // knows what went wrong with their copy.
    const apiError =
      (parsed as { ok?: boolean; error?: string })?.ok === false
        ? (parsed as { error?: string }).error
        : null;
    return empty(
      apiError
        ? `Slack response contained ok=false (error: "${apiError}"). ` +
            `You may have copied a failed request — pick a request that returned 200 OK.`
        : `Could not find a channels array in the pasted JSON. ` +
            `Looked in $.channels, $.self.channels, $.data.channels, and root. ` +
            `Make sure you copied the RESPONSE BODY of a request like client.boot, ` +
            `client.counts, or users.conversations.`,
    );
  }

  // Normalize. Skip rows missing id or name. Coerce booleans defensively.
  const channels: PastedChannel[] = [];
  const seenIds = new Set<string>();
  for (const c of rawChannels as unknown[]) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : null;
    const name = typeof obj.name === 'string' ? obj.name : null;
    if (!id || !name) continue;
    if (!CHANNEL_ID_RE.test(id)) continue; // ignore weird ids
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    channels.push({
      id,
      name: name.toLowerCase(),
      isArchived: obj.is_archived === true,
      isPrivate: obj.is_private === true,
    });
  }

  if (channels.length === 0) {
    // Diagnose the most common case: rows had ids but no names. This
    // happens when the operator copied a client.counts response —
    // client.counts carries unread/activity state per channel
    // (id + last_read + mention_count + ...) but NOT channel names.
    // Names live on client.boot, users.conversations, conversations.list,
    // and conversations.info. Tell the operator exactly what to do.
    const sample = (rawChannels as unknown[]).slice(0, 3) as Array<Record<string, unknown>>;
    const sampleHasId = sample.some((r) => r && typeof r.id === 'string');
    const sampleHasName = sample.some((r) => r && typeof r.name === 'string');
    if (sampleHasId && !sampleHasName) {
      const fields = sample[0] ? Object.keys(sample[0]).slice(0, 8).join(', ') : '(none)';
      return empty(
        `Found a channels array at ${sourcePath} (${(rawChannels as unknown[]).length} rows), ` +
          `but rows have no "name" field — only metadata like: ${fields}. ` +
          `This is almost certainly a client.counts response, which carries ` +
          `unread/activity state but NOT channel names. ` +
          `Copy a users.conversations or client.boot response instead (those carry name).`,
      );
    }
    return empty(
      `Found a channels array at ${sourcePath} but no usable rows ` +
        `(every row was missing id/name or had a malformed id). ` +
        `Make sure you copied the full response, not a truncated preview.`,
    );
  }

  return { channels, sourcePath, error: null };
}

/**
 * Fuzzy-match score between two channel names. Used to surface
 * "looks like maybe" suggestions when the exact cust-{slug} doesn't
 * appear in the pasted channels but a close variant does.
 *
 * Rules (cheap, tuned for cust-* names):
 *   - Equal → 1.0
 *   - One is a prefix of the other (e.g. cust-acme vs cust-acme-corp) → 0.85
 *   - Edit distance ≤ 2 on the slug portion → 0.7
 *   - Otherwise → 0
 *
 * Threshold for "near match" is 0.65 — only the prefix and tight
 * edit-distance cases qualify.
 */
export function nameMatchScore(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 1;
  // Prefix match (one extends the other).
  if (x.startsWith(y) || y.startsWith(x)) return 0.85;
  // Edit distance for the rest.
  const dist = levenshtein(x, y);
  if (dist <= 1) return 0.8;
  if (dist <= 2) return 0.7;
  return 0;
}

// Minimal Levenshtein. Bounded to short channel names (rarely >40
// chars), so the O(n*m) implementation is fine.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const v0: number[] = new Array(b.length + 1);
  const v1: number[] = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j]! + 1, v0[j + 1]! + 1, v0[j]! + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]!;
  }
  return v0[b.length]!;
}

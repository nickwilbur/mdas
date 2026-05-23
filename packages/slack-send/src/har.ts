// HAR file → Slack channel list extractor.
//
// A HAR file is the standardized DevTools export of all network activity
// on a tab. When the operator opens Slack web with DevTools' Network tab
// recording, reloads, and saves the HAR ("Save all as HAR with content"),
// the file contains the response body of every API call Slack made
// during the page load. Among those calls is at least one (usually
// several) that carries the full channel directory the operator can see.
//
// Why HAR vs. anything else we tried:
//   - users.conversations: blocked by `enterprise_is_restricted` on Zuora
//     (Enterprise Grid admin policy; documented limitation).
//   - localStorage.localConfig_v2: Slack rotated the key, the API token
//     is no longer there.
//   - IndexedDB scrape: modern Slack stores channel metadata server-side
//     (Loom / Flannel) and fetches lazily via the edge API; the browser
//     doesn't keep a complete local copy.
//   - client.boot endpoint copy-paste: lives at `x.slack.com/api/`, not
//     `slack.com/api/`, so operators couldn't find it by filtering.
//
// HAR sidesteps all of that. We don't care which endpoint actually
// served the data — we walk every entry in the HAR, try to JSON-parse
// each response body, and collect anything that looks like a channel
// from any of the shapes Slack uses across its boot/edge/admin APIs.
//
// Shapes we handle (all from real captured Slack traffic):
//
//   1. `client.boot` / `client.userBoot` response:
//        $.channels: [{ id, name, is_archived, is_private, ... }, ...]
//        $.ims:      [...]   (DMs — we skip; we want named channels)
//        $.groups:   [...]   (private channels — included)
//
//   2. Edge API (`edgeapi.slack.com/cache/<E>/channels/info`):
//        $.results: [{ id, name, ... }, ...]
//        — the response is a batch lookup, but it returns the same
//        channel object shape.
//
//   3. Edge API (`channels/search`):
//        $.results: [...] — same shape.
//
//   4. `conversations.info` / `conversations.list`:
//        $.channels: [...] or $.channel: { ... } (singular).
//
//   5. `search.modules.channels`:
//        $.items: [...].
//
// We dedupe by id (preferring live over archived), filter to `Cxxx` /
// `Gxxx` ids (channels/private groups; we skip DMs which start with D),
// and require a non-empty `name`.

export interface HarChannel {
  id: string;
  name: string;
  isArchived: boolean;
  isPrivate: boolean;
}

export interface HarExtractResult {
  channels: HarChannel[];
  /** Per-source breakdown for transparency: which endpoints contributed
   * channels, how many from each. Useful diagnostic when the result
   * looks short (operator can see "oh, only one source fired, I need
   * to scroll a channel into view to trigger more"). */
  sources: Array<{ url: string; status: number; count: number }>;
  /** Total HAR entries inspected (regardless of whether they contained
   * channels). Useful sanity check: very low number = HAR is empty
   * because operator didn't actually reload. */
  entriesInspected: number;
  /** Non-null on parse failure. */
  error: string | null;
}

const CHANNEL_ID_RE = /^[CG][A-Z0-9]{8,}$/; // channels + private groups, NOT DMs (D...)

interface HarFile {
  log?: { entries?: HarEntry[] };
}
interface HarEntry {
  request?: { url?: string; method?: string };
  response?: {
    status?: number;
    content?: { mimeType?: string; text?: string; encoding?: string };
  };
}

export function extractChannelsFromHar(rawHarText: string): HarExtractResult {
  const empty = (error: string): HarExtractResult => ({
    channels: [],
    sources: [],
    entriesInspected: 0,
    error,
  });

  if (!rawHarText || typeof rawHarText !== 'string') {
    return empty('Empty HAR — drag a .har file in or paste the file contents.');
  }

  let har: HarFile;
  try {
    har = JSON.parse(rawHarText) as HarFile;
  } catch (e) {
    return empty(
      `Could not parse as HAR (HAR is JSON): ${(e as Error).message}. ` +
        `Make sure you used "Save all as HAR with content" from the Network ` +
        `panel context menu, and uploaded the .har file directly.`,
    );
  }

  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) {
    return empty(
      `HAR is missing $.log.entries — file doesn't look like a HAR export.`,
    );
  }

  const byId = new Map<string, HarChannel>();
  const sources: HarExtractResult['sources'] = [];

  for (const entry of entries) {
    const url = entry?.request?.url ?? '';
    const status = entry?.response?.status ?? 0;
    const content = entry?.response?.content;
    const text = content?.text;
    // Skip non-Slack and non-success entries fast.
    if (!text) continue;
    if (status !== 200) continue;
    if (!/slack\.com|slack-edge|slack-imgs|onquip/.test(url)) continue;
    // Skip obvious non-JSON content types (HAR sometimes has mimeType set
    // but it's often missing or "text/plain"; the surest test is JSON.parse).
    if (content?.mimeType && !/json|text\/plain|application\/octet/.test(content.mimeType))
      continue;

    // Handle base64-encoded HAR bodies (Chrome sometimes encodes binary,
    // and even some text bodies depending on the browser).
    let body: string;
    try {
      body = content?.encoding === 'base64' ? atob(text) : text;
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }

    const collected = collectChannelsFromPayload(parsed);
    if (collected.length > 0) {
      sources.push({ url: shortenUrl(url), status, count: collected.length });
      for (const c of collected) {
        const existing = byId.get(c.id);
        // Prefer non-archived on collision; otherwise keep first.
        if (!existing || (existing.isArchived && !c.isArchived)) {
          byId.set(c.id, c);
        }
      }
    }
  }

  const channels = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));

  if (channels.length === 0) {
    const hint =
      entries.length === 0
        ? 'HAR contains zero entries — recording was empty. Reload the Slack tab with DevTools recording, then re-export.'
        : `HAR has ${entries.length} entries but none contained channel data. ` +
          `Try: open a couple of #cust-* channels in Slack while recording, ` +
          `or use the channel switcher (⌘K) and type a few prefixes — that ` +
          `fires the edge API search endpoint which returns channel objects.`;
    return {
      channels: [],
      sources: [],
      entriesInspected: entries.length,
      error: hint,
    };
  }

  return { channels, sources, entriesInspected: entries.length, error: null };
}

// Walk an arbitrary JSON payload and collect anything that looks like a
// channel record. We're permissive: any object with a string `id` matching
// CHANNEL_ID_RE and a non-empty string `name` counts. This handles every
// Slack response shape without us needing to know which endpoint it came
// from (and is resilient to Slack adding new shapes in the future).
function collectChannelsFromPayload(root: unknown): HarChannel[] {
  const out: HarChannel[] = [];
  const seen = new Set<unknown>();
  // Iterative DFS; bounded depth-based pruning to avoid worst-case time
  // on huge boot payloads (which can be 100k+ keys when fully expanded).
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  const MAX_DEPTH = 8;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (depth > MAX_DEPTH) continue;

    if (Array.isArray(node)) {
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
      continue;
    }

    const obj = node as Record<string, unknown>;
    // Channel-shaped check.
    const id = typeof obj.id === 'string' ? obj.id : null;
    const name = typeof obj.name === 'string' ? obj.name : null;
    if (id && name && CHANNEL_ID_RE.test(id) && name.length > 0) {
      out.push({
        id,
        name: name.toLowerCase(),
        isArchived: obj.is_archived === true,
        isPrivate: obj.is_private === true,
      });
      // Still descend — sometimes nested channels live under .shared_with
      // or similar on shared channel objects.
    }

    for (const key of Object.keys(obj)) {
      stack.push({ node: obj[key], depth: depth + 1 });
    }
  }
  return out;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url.slice(0, 120);
  }
}

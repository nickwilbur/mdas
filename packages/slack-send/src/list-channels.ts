// Read-only Slack channel directory loader.
//
// One pass per refresh of `conversations.list?types=public_channel`,
// cursor-paginated. Used to:
//   1. Resolve a channel-id (Cxxx) to its current human name, and
//   2. Resolve a candidate channel-name (cust-acme) to a channel-id.
//
// Strict read-only:
//   - Public channels only (types=public_channel). We do NOT request
//     private_channel / mpim / im, because seeing those requires the
//     bot to be invited into each channel — and per the operating
//     constraint we are explicitly NOT joining channels.
//   - Requires only `channels:read` scope. No write scopes touched.
//   - Does not call chat.postMessage, conversations.join, or any
//     state-mutating endpoint.
//   - Works with either a bot token (xoxb-) or a user token (xoxp-).
//     For user tokens the channel directory returned is whatever the
//     user can see — typically the same public-channel set as a bot.
//
// Private cust-* channels (the typical customer channel pattern) will
// NOT appear in the index. Rows whose canonical channel is private
// simply won't get a real name back — they fall through to the
// convention name (`cust-{slug}`) as the displayed channel name, with
// no URL when source=heuristic.
//
// We intentionally cap pages to avoid pathological workspace sizes.

export interface SlackChannelSummary {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface ChannelIndex {
  byId: Map<string, SlackChannelSummary>;
  byName: Map<string, SlackChannelSummary>;
  /** Number of channels indexed (post-pagination). */
  total: number;
  /** True iff a bot token was usable and at least one page was fetched. */
  fetched: boolean;
}

export const EMPTY_INDEX: ChannelIndex = {
  byId: new Map(),
  byName: new Map(),
  total: 0,
  fetched: false,
};

const MAX_PAGES = 25; // hard cap; 25 * 1000 = 25k public channels — plenty.
const PAGE_SIZE = 1000; // conversations.list max per-page.

export async function fetchPublicChannelIndex(opts: {
  /** Bot/user/xoxc token. Null/empty skips fetching and returns EMPTY_INDEX. */
  readToken: string | null;
  /**
   * Matching `d` cookie value. REQUIRED when `readToken` is an xoxc-…
   * browser-session token (Slack rejects xoxc without cookie). Ignored
   * for xoxb-/xoxp- tokens. Pass `null` for those.
   */
  readCookie?: string | null;
}): Promise<ChannelIndex> {
  if (!opts.readToken) return EMPTY_INDEX;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.readToken}`,
  };
  if (opts.readCookie) {
    headers.Cookie = `d=${opts.readCookie}`;
  }

  const byId = new Map<string, SlackChannelSummary>();
  const byName = new Map<string, SlackChannelSummary>();
  let cursor: string | undefined = undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({
      types: 'public_channel',
      exclude_archived: 'false', // include archived so we can flag them
      limit: String(PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Slack conversations.list HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      ok: boolean;
      error?: string;
      channels?: { id: string; name: string; is_archived?: boolean }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!body.ok) {
      throw new Error(`Slack conversations.list error: ${body.error ?? 'unknown'}`);
    }

    for (const c of body.channels ?? []) {
      const s: SlackChannelSummary = {
        id: c.id,
        name: c.name,
        isArchived: !!c.is_archived,
      };
      byId.set(c.id, s);
      // If two channels share a name (rare — only possible across
      // archived vs live), prefer the live one. Archived channels can't
      // receive messages anyway.
      const existing = byName.get(c.name);
      if (!existing || (existing.isArchived && !s.isArchived)) {
        byName.set(c.name, s);
      }
    }

    cursor = body.response_metadata?.next_cursor;
    pages++;
    if (!cursor) break;
  }

  return { byId, byName, total: byId.size, fetched: true };
}

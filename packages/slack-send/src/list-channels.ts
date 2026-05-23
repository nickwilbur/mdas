// Read-only Slack channel directory loader.
//
// One pass per refresh of `conversations.list`, cursor-paginated. Used to:
//   1. Resolve a channel-id (Cxxx) to its current human name, and
//   2. Resolve a candidate channel-name (cust-acme) to a channel-id.
//
// IMPORTANT — Enterprise Grid restriction observed in Zuora:
//   Org admins can disable `conversations.list` for non-admin tokens via
//   "Admin > Apps > Permissions for Apps > Restrict listing of channels".
//   When this is enforced, BOTH xoxb-/xoxp-/xoxc tokens get back
//   `{ ok: false, error: "enterprise_is_restricted" }` regardless of
//   scope set. There is no workaround at the API layer — admin policy
//   wins. In that case, this function will throw on the first page
//   fetch, the caller catches it, and the index stays EMPTY_INDEX.
//   The mapping refresh remains useful — channels already known by id
//   (from Salesforce) can still be name-resolved and validity-checked
//   via `conversations.info`, which is NOT restricted. Heuristic
//   candidates whose channel id is unknown will simply stay as
//   `heuristic_candidate` (use the per-row "Map URL" admin action to
//   resolve them manually).
//
// Strict read-only — no chat.postMessage, no conversations.join, no
// state-mutating endpoint regardless of token kind.
//
// Channel types returned depends on the token kind, with the
// "never elevate to see more than you already could" principle:
//
//   - BOT token (xoxb-): public_channel ONLY. The bot would need to be
//     explicitly invited to see private channels, and the operating
//     constraint is that the bot is NOT joining channels. Private
//     cust-* channels mapped to a bot token will simply not appear in
//     the index; rows fall through to the convention name with no URL.
//
//   - USER token (xoxp-) or BROWSER-SESSION token (xoxc-):
//     public_channel + private_channel. Slack returns ONLY the channels
//     the underlying human user can see. We are NOT elevating access —
//     we're surfacing channels the operator is already a member of so
//     their cust-* heuristic candidates can resolve to real channel ids.
//     A teammate running the same tool with their own xoxc would see
//     a different (their own) set of private channels.
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
  /**
   * Whether private channels were included in this fetch (true for
   * user/xoxc tokens, false for bot tokens). Surfaced so the UI can
   * tell operators that an index built under their own xoxc reflects
   * their personal channel membership.
   */
  includesPrivate: boolean;
}

export const EMPTY_INDEX: ChannelIndex = {
  byId: new Map(),
  byName: new Map(),
  total: 0,
  fetched: false,
  includesPrivate: false,
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
  /**
   * Token kind. Determines which channel types we request:
   *   - 'bot'  → public_channel only (bot is not joining anything).
   *   - 'user' → public_channel + private_channel (user sees what they see).
   *   - 'xoxc' → public_channel + private_channel (browser session is the user).
   * Defaults to 'bot' (safest) when not provided.
   */
  tokenKind?: 'bot' | 'user' | 'xoxc';
}): Promise<ChannelIndex> {
  if (!opts.readToken) return EMPTY_INDEX;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.readToken}`,
  };
  if (opts.readCookie) {
    headers.Cookie = `d=${opts.readCookie}`;
  }

  // See top-of-file note for rationale. Bot tokens stay public-only so
  // we never accidentally elevate access; user/xoxc include private
  // because the underlying human already sees them.
  const types =
    opts.tokenKind === 'user' || opts.tokenKind === 'xoxc'
      ? 'public_channel,private_channel'
      : 'public_channel';

  const byId = new Map<string, SlackChannelSummary>();
  const byName = new Map<string, SlackChannelSummary>();
  let cursor: string | undefined = undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({
      types,
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

  return {
    byId,
    byName,
    total: byId.size,
    fetched: true,
    includesPrivate: types.includes('private_channel'),
  };
}

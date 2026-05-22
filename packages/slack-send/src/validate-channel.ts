// Read-only Slack channel-id validator.
//
// Wraps Slack's `conversations.info`. Used by the mapping refresh to
// disambiguate channel-ids that aren't in the public-channel index.
//
// Categories returned:
//
//   { state: 'live',        isArchived: false }   — channel exists, accessible
//   { state: 'live',        isArchived: true  }   — exists but archived
//   { state: 'inaccessible' }                     — channel_not_found / not_in_channel
//   { state: 'private'     }                      — channel_not_visible (private to the bot)
//   { state: 'unknown',     error: <slack-code> } — other API errors
//
// Strictly read-only. We do not call conversations.join, conversations.invite,
// or any state-mutating endpoint — even on `inaccessible` results. The
// caller decides what to record in the mapping table.
//
// Rate-limit aware: the caller is responsible for bounding the number
// of validate calls per refresh (typically by skipping ids that are
// already in the public-channel index, and by skipping rows whose
// terminal state is sticky — see slack-mapping.ts).

export type ChannelValidation =
  | { state: 'live'; isArchived: boolean }
  | { state: 'inaccessible'; slackError: string }
  | { state: 'private'; slackError: string }
  | { state: 'unknown'; slackError: string };

const INACCESSIBLE_ERRORS = new Set([
  'channel_not_found',
  'not_in_channel',
  'is_archived', // some legacy calls return this on info; we treat as inaccessible-for-send
]);
const PRIVATE_ERRORS = new Set([
  'channel_not_visible',
  'missing_scope', // not the same thing but practically — bot lacks groups:read; treat as not-visible
]);

export async function validateChannelId(opts: {
  /** Bot/user/xoxc token (all work for conversations.info on public channels). */
  readToken: string;
  /** Required for xoxc; null for xoxb/xoxp. See ReadAuth in gate.ts. */
  readCookie?: string | null;
  channelId: string;
}): Promise<ChannelValidation> {
  const params = new URLSearchParams({ channel: opts.channelId });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.readToken}`,
  };
  if (opts.readCookie) {
    headers.Cookie = `d=${opts.readCookie}`;
  }
  const res = await fetch(`https://slack.com/api/conversations.info?${params}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    return { state: 'unknown', slackError: `http_${res.status}` };
  }
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    channel?: { is_archived?: boolean };
  };

  if (body.ok) {
    return { state: 'live', isArchived: !!body.channel?.is_archived };
  }
  const err = body.error ?? 'unknown';
  if (INACCESSIBLE_ERRORS.has(err)) return { state: 'inaccessible', slackError: err };
  if (PRIVATE_ERRORS.has(err)) return { state: 'private', slackError: err };
  return { state: 'unknown', slackError: err };
}

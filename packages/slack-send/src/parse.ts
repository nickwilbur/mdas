// Slack URL parsing — strict, fail-closed.
//
// We accept only the canonical Slack web URL shapes:
//
//   https://<workspace>.slack.com/archives/<CHANNEL_ID>
//   https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<TS>     (deep link to message)
//   https://app.slack.com/client/<TEAM_ID>/<CHANNEL_ID>
//   https://<workspace>.enterprise.slack.com/archives/<CHANNEL_ID>
//
// CHANNEL_ID prefixes:
//   C  public channel
//   G  legacy private group / private channel
//   D  direct message
//
// We do NOT accept slack:// app deep links or channel-name URLs
// (https://workspace.slack.com/messages/general) because those don't
// carry a stable id and would require a Slack API lookup to resolve.
// Marking those `invalid_slack_url` is the safe default and matches the
// "make gaps explicit rather than hiding them" principle from the spec.

export interface ParsedSlackUrl {
  channelId: string;
  /** The workspace/team subdomain when present, else null (app.slack.com URLs). */
  workspace: string | null;
  /** True if the URL pointed at a specific message (we still return the channel). */
  hasMessageAnchor: boolean;
}

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;

export function isValidSlackChannelId(id: string | null | undefined): boolean {
  return typeof id === 'string' && CHANNEL_ID_RE.test(id);
}

export function parseSlackUrl(raw: string | null | undefined): ParsedSlackUrl | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const isSlackHost =
    host.endsWith('.slack.com') ||
    host === 'slack.com' ||
    host === 'app.slack.com';
  if (!isSlackHost) return null;

  const parts = url.pathname.split('/').filter(Boolean);

  // /archives/<CHANNEL_ID>[/p<ts>]
  if (parts[0] === 'archives' && parts[1]) {
    const channelId = parts[1];
    if (!isValidSlackChannelId(channelId)) return null;
    const workspace = host.endsWith('.slack.com') && host !== 'app.slack.com'
      ? host.replace(/\.slack\.com$/, '').replace(/\.enterprise$/, '')
      : null;
    return {
      channelId,
      workspace,
      hasMessageAnchor: !!parts[2] && parts[2].startsWith('p'),
    };
  }

  // /client/<TEAM_ID>/<CHANNEL_ID>
  if (parts[0] === 'client' && parts[1] && parts[2]) {
    const channelId = parts[2];
    if (!isValidSlackChannelId(channelId)) return null;
    return { channelId, workspace: null, hasMessageAnchor: false };
  }

  return null;
}

// Minimal single-target Slack chat.postMessage client.
//
// Deliberately NOT a batch API. The function takes exactly one channel id
// and one message body. There is no array, no "channels" plural, no
// fan-out helper. The "no bulk send path" guarantee from the spec is
// enforced at the type level here.
//
// Callers MUST call `assertSendEnabled(...)` before invoking this.
// `postMessage` itself does NOT consult the env toggle: it's a thin HTTP
// wrapper, gated by its callers. This keeps the gate testable in isolation
// and lets unit tests inject a non-production toggle state cleanly.

export interface SlackPostInput {
  /** xoxb-… bot token. */
  botToken: string;
  /** Single channel id (Cxxx, Gxxx, Dxxx) or a user id (Uxxx) for DM. */
  channel: string;
  /** Plain text message body. */
  text: string;
}

export interface SlackPostResult {
  ok: true;
  channel: string;
  ts: string;
}

export class SlackApiError extends Error {
  readonly slackError: string;
  constructor(slackError: string, message: string) {
    super(message);
    this.slackError = slackError;
    this.name = 'SlackApiError';
  }
}

export async function postMessage(input: SlackPostInput): Promise<SlackPostResult> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new SlackApiError(
      'http_' + res.status,
      `Slack API HTTP ${res.status}`,
    );
  }

  const body = (await res.json()) as { ok: boolean; error?: string; channel?: string; ts?: string };
  if (!body.ok) {
    throw new SlackApiError(body.error ?? 'unknown', `Slack API error: ${body.error ?? 'unknown'}`);
  }
  return { ok: true, channel: body.channel ?? input.channel, ts: body.ts ?? '' };
}

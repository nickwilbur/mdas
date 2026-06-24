import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateChannelId } from './validate-channel.js';

const origFetch = globalThis.fetch;

function mockSlackResponse(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('validateChannelId', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns live/unarchived for accessible channels', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, channel: { is_archived: false } }),
    });

    const result = await validateChannelId({ readToken: 'xoxb-test', channelId: 'C111' });
    expect(result).toEqual({ state: 'live', isArchived: false });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('conversations.info?channel=C111'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer xoxb-test' }),
      }),
    );
  });

  it('returns live/archived when Slack reports the channel is archived', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, channel: { is_archived: true } }),
    });

    const result = await validateChannelId({ readToken: 'xoxb-test', channelId: 'C222' });
    expect(result).toEqual({ state: 'live', isArchived: true });
  });

  it('maps channel_not_found and not_in_channel to inaccessible', async () => {
    for (const err of ['channel_not_found', 'not_in_channel', 'is_archived']) {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: err }),
      });
      const result = await validateChannelId({ readToken: 'xoxb-test', channelId: 'C333' });
      expect(result).toEqual({ state: 'inaccessible', slackError: err });
    }
  });

  it('maps channel_not_visible and missing_scope to private', async () => {
    for (const err of ['channel_not_visible', 'missing_scope']) {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: err }),
      });
      const result = await validateChannelId({ readToken: 'xoxb-test', channelId: 'C444' });
      expect(result).toEqual({ state: 'private', slackError: err });
    }
  });

  it('returns unknown for other Slack API errors and HTTP failures', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'ratelimited' }),
    });
    expect(await validateChannelId({ readToken: 'xoxb-test', channelId: 'C555' })).toEqual({
      state: 'unknown',
      slackError: 'ratelimited',
    });

    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await validateChannelId({ readToken: 'xoxb-test', channelId: 'C555' })).toEqual({
      state: 'unknown',
      slackError: 'http_503',
    });
  });

  it('sends xoxc cookie header when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, channel: { is_archived: false } }),
    });

    await validateChannelId({
      readToken: 'xoxc-test',
      readCookie: 'xoxd-cookie',
      channelId: 'C666',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxc-test',
          Cookie: 'd=xoxd-cookie',
        }),
      }),
    );
  });
});

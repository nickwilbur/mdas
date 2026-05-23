// Tests for fetchPublicChannelIndex — specifically the token-kind branch
// that decides whether private channels are included.
//
// We mock fetch and assert (a) the `types=` query parameter, (b) the
// resulting index's `includesPrivate` flag, and (c) the "no elevation
// for bot tokens" rule.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPublicChannelIndex, EMPTY_INDEX } from './list-channels.js';

const origFetch = globalThis.fetch;

function mockFetchReturning(channels: Array<{ id: string; name: string; is_archived?: boolean }>) {
  return vi.fn(async (url: string) => {
    return {
      ok: true,
      json: async () => ({ ok: true, channels, response_metadata: { next_cursor: '' } }),
    } as Response;
  });
}

function lastFetchUrl(mock: ReturnType<typeof vi.fn>): string {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe('fetchPublicChannelIndex', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = mockFetchReturning([
      { id: 'C111', name: 'cust-acme' },
      { id: 'C222', name: 'cust-globex', is_archived: true },
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns EMPTY_INDEX when no token is provided', async () => {
    const idx = await fetchPublicChannelIndex({ readToken: null });
    expect(idx).toBe(EMPTY_INDEX);
    expect(idx.includesPrivate).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('BOT token: requests ONLY public channels (no elevation)', async () => {
    const idx = await fetchPublicChannelIndex({ readToken: 'xoxb-test', tokenKind: 'bot' });
    expect(lastFetchUrl(fetchMock)).toContain('types=public_channel');
    expect(lastFetchUrl(fetchMock)).not.toContain('private_channel');
    expect(idx.includesPrivate).toBe(false);
    expect(idx.total).toBe(2);
    expect(idx.byName.get('cust-acme')?.id).toBe('C111');
  });

  it('BOT token: defaults applied when tokenKind omitted (safest = bot)', async () => {
    await fetchPublicChannelIndex({ readToken: 'xoxb-test' });
    // No tokenKind passed → fall through to public-only, no private.
    expect(lastFetchUrl(fetchMock)).not.toContain('private_channel');
  });

  it('USER token: requests public AND private channels (operator-scoped)', async () => {
    const idx = await fetchPublicChannelIndex({
      readToken: 'xoxp-test',
      tokenKind: 'user',
    });
    expect(lastFetchUrl(fetchMock)).toContain('public_channel');
    expect(lastFetchUrl(fetchMock)).toContain('private_channel');
    expect(idx.includesPrivate).toBe(true);
  });

  it('XOXC token: requests public AND private channels, sends Cookie header', async () => {
    const idx = await fetchPublicChannelIndex({
      readToken: 'xoxc-test',
      readCookie: 'xoxd-cookie-value',
      tokenKind: 'xoxc',
    });
    expect(lastFetchUrl(fetchMock)).toContain('public_channel');
    expect(lastFetchUrl(fetchMock)).toContain('private_channel');
    expect(idx.includesPrivate).toBe(true);

    // Assert Cookie header was attached.
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe('d=xoxd-cookie-value');
    expect(headers.Authorization).toBe('Bearer xoxc-test');
  });

  it('byName lookup prefers live over archived channels with the same name', async () => {
    // Simulate one archived + one live with the same name.
    globalThis.fetch = mockFetchReturning([
      { id: 'C_ARCHIVED', name: 'cust-acme', is_archived: true },
      { id: 'C_LIVE', name: 'cust-acme', is_archived: false },
    ]) as unknown as typeof fetch;
    const idx = await fetchPublicChannelIndex({ readToken: 'xoxb-test', tokenKind: 'bot' });
    // Live wins for the name lookup; both still in byId.
    expect(idx.byName.get('cust-acme')?.id).toBe('C_LIVE');
    expect(idx.byId.get('C_ARCHIVED')?.isArchived).toBe(true);
    expect(idx.byId.get('C_LIVE')?.isArchived).toBe(false);
  });
});

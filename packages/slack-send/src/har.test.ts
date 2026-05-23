import { describe, expect, it } from 'vitest';
import { extractChannelsFromHar } from './har.js';

// Builds a minimal HAR file containing one entry with the given JSON body.
function har(entries: Array<{ url: string; status?: number; body: unknown; mimeType?: string }>) {
  return JSON.stringify({
    log: {
      entries: entries.map((e) => ({
        request: { url: e.url, method: 'POST' },
        response: {
          status: e.status ?? 200,
          content: {
            mimeType: e.mimeType ?? 'application/json',
            text: typeof e.body === 'string' ? e.body : JSON.stringify(e.body),
          },
        },
      })),
    },
  });
}

describe('extractChannelsFromHar', () => {
  it('extracts from a client.userBoot response', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/client.userBoot',
        body: {
          ok: true,
          channels: [
            { id: 'C0000000001', name: 'cust-acme', is_archived: false, is_private: false },
            { id: 'C0000000002', name: 'cust-foo', is_archived: true },
            { id: 'C0000000003', name: 'cust-private', is_private: true },
          ],
          ims: [
            { id: 'D0000000001', name: 'directmessage' }, // should be skipped (D...)
          ],
          self: { id: 'U0000000001', name: 'someone' }, // should be skipped (U...)
        },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.error).toBeNull();
    expect(r.channels.map((c) => c.name).sort()).toEqual(['cust-acme', 'cust-foo', 'cust-private']);
    expect(r.channels.find((c) => c.id === 'C0000000002')!.isArchived).toBe(true);
    expect(r.channels.find((c) => c.id === 'C0000000003')!.isPrivate).toBe(true);
  });

  it('extracts from an edge API channels/info response under $.results', () => {
    const text = har([
      {
        url: 'https://edgeapi.slack.com/cache/E0123ABCDEF/channels/info',
        body: {
          results: [
            { id: 'C0000000004', name: 'cust-edge', is_archived: false },
            { id: 'C0000000005', name: 'cust-edge-two' },
          ],
        },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.error).toBeNull();
    expect(r.channels).toHaveLength(2);
  });

  it('extracts from search.modules.channels $.items', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/search.modules.channels',
        body: {
          module: 'channels',
          items: [{ id: 'C0000000006', name: 'cust-search' }],
        },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.error).toBeNull();
    expect(r.channels[0]!.name).toBe('cust-search');
  });

  it('merges channels across multiple Slack entries and dedupes by id', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/client.userBoot',
        body: { channels: [{ id: 'C0000000007', name: 'cust-dup', is_archived: true }] },
      },
      {
        url: 'https://edgeapi.slack.com/cache/E1/channels/info',
        body: { results: [{ id: 'C0000000007', name: 'cust-dup', is_archived: false }] },
      },
      {
        url: 'https://acme.slack.com/api/conversations.info',
        body: { ok: true, channel: { id: 'C0000000008', name: 'cust-extra' } },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(2);
    // The dedup picked the non-archived one.
    expect(r.channels.find((c) => c.id === 'C0000000007')!.isArchived).toBe(false);
    expect(r.sources).toHaveLength(3);
  });

  it('ignores non-Slack entries and non-200 responses', () => {
    const text = har([
      { url: 'https://example.com/api/whatever', body: { channels: [{ id: 'C0000000009', name: 'should-be-ignored' }] } },
      { url: 'https://acme.slack.com/api/something', status: 500, body: { channels: [{ id: 'C0000000010', name: 'also-ignored' }] } },
      { url: 'https://acme.slack.com/api/ok', body: { channels: [{ id: 'C0000000011', name: 'cust-real' }] } },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0]!.name).toBe('cust-real');
  });

  it('skips DM ids (D prefix) and user ids (U prefix)', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/x',
        body: {
          channels: [
            { id: 'C0000000020', name: 'cust-keep' },
            { id: 'D0000000001', name: 'directmessage-skip' },
            { id: 'U0000000001', name: 'user-skip' },
          ],
        },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0]!.id).toBe('C0000000020');
  });

  it('handles base64-encoded bodies (some browsers encode JSON in HAR)', () => {
    const inner = JSON.stringify({ channels: [{ id: 'C0000000021', name: 'cust-b64' }] });
    const encoded =
      typeof Buffer !== 'undefined' ? Buffer.from(inner).toString('base64') : btoa(inner);
    const text = JSON.stringify({
      log: {
        entries: [
          {
            request: { url: 'https://acme.slack.com/api/x', method: 'POST' },
            response: {
              status: 200,
              content: { mimeType: 'application/json', text: encoded, encoding: 'base64' },
            },
          },
        ],
      },
    });
    const r = extractChannelsFromHar(text);
    expect(r.error).toBeNull();
    expect(r.channels[0]!.id).toBe('C0000000021');
  });

  it('walks deeply nested payloads (real client.userBoot is deeply nested)', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/client.userBoot',
        body: {
          ok: true,
          user: {
            prefs: {
              starred: [{ id: 'C0000000030', name: 'cust-deep-nested' }],
            },
          },
        },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0]!.name).toBe('cust-deep-nested');
  });

  it('gives a helpful error for empty HAR (no entries)', () => {
    const text = JSON.stringify({ log: { entries: [] } });
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/zero entries/);
  });

  it('gives a helpful error when entries exist but no channels found', () => {
    const text = har([{ url: 'https://acme.slack.com/api/whatever', body: { ok: true, something: 'else' } }]);
    const r = extractChannelsFromHar(text);
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/entries but none contained channel data/);
    expect(r.error).toMatch(/⌘K/);
  });

  it('gives a helpful error for malformed JSON', () => {
    const r = extractChannelsFromHar('{ not json');
    expect(r.error).toMatch(/Could not parse as HAR/);
  });

  it('gives a helpful error for non-HAR JSON', () => {
    const r = extractChannelsFromHar(JSON.stringify({ ok: true, channels: [] }));
    expect(r.error).toMatch(/missing \$\.log\.entries/);
  });

  it('reports per-source counts in the result', () => {
    const text = har([
      {
        url: 'https://acme.slack.com/api/client.userBoot',
        body: { channels: [{ id: 'C0000000040', name: 'a' }, { id: 'C0000000041', name: 'b' }] },
      },
      {
        url: 'https://edgeapi.slack.com/cache/E1/channels/info',
        body: { results: [{ id: 'C0000000042', name: 'c' }] },
      },
    ]);
    const r = extractChannelsFromHar(text);
    expect(r.sources).toHaveLength(2);
    expect(r.sources.find((s) => s.url.includes('client.userBoot'))!.count).toBe(2);
    expect(r.sources.find((s) => s.url.includes('edgeapi'))!.count).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { nameMatchScore, parseChannelPaste } from './paste.js';

describe('parseChannelPaste', () => {
  it('extracts channels from a users.conversations response', () => {
    const body = JSON.stringify({
      ok: true,
      channels: [
        { id: 'C0123ABCDEF', name: 'cust-acme', is_archived: false, is_private: false },
        { id: 'C0123ABCDEG', name: 'cust-foo', is_archived: true, is_private: false },
        { id: 'C0123ABCDEH', name: 'cust-bar', is_private: true },
      ],
      response_metadata: { next_cursor: '' },
    });
    const r = parseChannelPaste(body);
    expect(r.error).toBeNull();
    expect(r.sourcePath).toBe('$.channels');
    expect(r.channels).toHaveLength(3);
    expect(r.channels[0]).toMatchObject({
      id: 'C0123ABCDEF',
      name: 'cust-acme',
      isArchived: false,
      isPrivate: false,
    });
    expect(r.channels[1]!.isArchived).toBe(true);
    expect(r.channels[2]!.isPrivate).toBe(true);
  });

  it('extracts from a bare channels array', () => {
    const body = JSON.stringify([
      { id: 'C0000000001', name: 'cust-one' },
      { id: 'C0000000002', name: 'cust-two' },
    ]);
    const r = parseChannelPaste(body);
    expect(r.error).toBeNull();
    expect(r.channels).toHaveLength(2);
  });

  it('extracts from client.boot-style nested self.channels', () => {
    const body = JSON.stringify({
      ok: true,
      self: {
        channels: [{ id: 'C9999999991', name: 'cust-nested' }],
      },
    });
    const r = parseChannelPaste(body);
    expect(r.error).toBeNull();
    expect(r.sourcePath).toBe('$.self.channels');
    expect(r.channels[0]!.name).toBe('cust-nested');
  });

  it('extracts from search.modules.channels-style $.items', () => {
    const body = JSON.stringify({
      ok: true,
      module: 'channels',
      items: [
        { id: 'C0000000099', name: 'cust-searched', is_private: false },
        { id: 'C0000000098', name: 'cust-also', is_archived: true },
      ],
    });
    const r = parseChannelPaste(body);
    expect(r.error).toBeNull();
    expect(r.sourcePath).toBe('$.items');
    expect(r.channels).toHaveLength(2);
  });

  it('ignores rows with malformed ids', () => {
    const body = JSON.stringify({
      ok: true,
      channels: [
        { id: 'NOTAVALIDID', name: 'cust-bogus' },
        { id: 'C0123ABCDEF', name: 'cust-good' },
      ],
    });
    const r = parseChannelPaste(body);
    expect(r.channels).toHaveLength(1);
    expect(r.channels[0]!.id).toBe('C0123ABCDEF');
  });

  it('dedupes by id and prefers live over archived', () => {
    const body = JSON.stringify({
      ok: true,
      channels: [
        { id: 'C0123ABCDEF', name: 'cust-dup', is_archived: true },
        { id: 'C0123ABCDEF', name: 'cust-dup', is_archived: false },
      ],
    });
    const r = parseChannelPaste(body);
    expect(r.channels).toHaveLength(1);
  });

  it('reports a clear error when the JSON is malformed', () => {
    const r = parseChannelPaste('{ this is not json');
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/Could not parse as JSON/);
  });

  it('reports a clear error on ok=false responses with the Slack error', () => {
    const r = parseChannelPaste(JSON.stringify({ ok: false, error: 'enterprise_is_restricted' }));
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/enterprise_is_restricted/);
  });

  it('gives a specific client.counts diagnostic when rows have ids but no names', () => {
    const body = JSON.stringify({
      ok: true,
      channels: [
        { id: 'C0123ABCDEF', last_read: '1234.5678', mention_count: 0, has_unreads: false },
        { id: 'C0123ABCDEG', last_read: '2345.6789', mention_count: 2, has_unreads: true },
      ],
    });
    const r = parseChannelPaste(body);
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/client\.counts/);
    expect(r.error).toMatch(/users\.conversations or client\.boot/);
  });

  it('reports a clear error when no channels array is anywhere', () => {
    const r = parseChannelPaste(JSON.stringify({ ok: true, something: 'else' }));
    expect(r.channels).toHaveLength(0);
    expect(r.error).toMatch(/Could not find a channels array/);
  });

  it('handles empty/null input gracefully', () => {
    expect(parseChannelPaste('').error).toMatch(/Empty paste/);
    expect(parseChannelPaste(null as unknown as string).error).toMatch(/Empty paste/);
  });

  it('strips DevTools "Response:" prefix that operators sometimes copy', () => {
    const body = 'Response: ' + JSON.stringify({ ok: true, channels: [{ id: 'C0000000001', name: 'cust-x' }] });
    const r = parseChannelPaste(body);
    expect(r.error).toBeNull();
    expect(r.channels).toHaveLength(1);
  });
});

describe('nameMatchScore', () => {
  it('returns 1 for exact match (case insensitive)', () => {
    expect(nameMatchScore('cust-acme', 'cust-acme')).toBe(1);
    expect(nameMatchScore('cust-acme', 'CUST-ACME')).toBe(1);
  });

  it('returns 0.85 for prefix match', () => {
    expect(nameMatchScore('cust-acme', 'cust-acme-corp')).toBe(0.85);
    expect(nameMatchScore('cust-acme-corp', 'cust-acme')).toBe(0.85);
  });

  it('returns ~0.8 for distance-1 typos', () => {
    expect(nameMatchScore('cust-acme', 'cust-acmes')).toBeGreaterThanOrEqual(0.8);
    expect(nameMatchScore('cust-acme', 'cust-acne')).toBeGreaterThanOrEqual(0.8);
  });

  it('returns 0.7 for distance-2 typos', () => {
    expect(nameMatchScore('cust-acme', 'cust-acmex')).toBeGreaterThanOrEqual(0.7);
  });

  it('returns 0 for unrelated names', () => {
    expect(nameMatchScore('cust-acme', 'cust-zoinks-and-the-mystery-machine')).toBe(0);
  });
});

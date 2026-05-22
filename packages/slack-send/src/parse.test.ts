import { describe, it, expect } from 'vitest';
import { parseSlackUrl, isValidSlackChannelId } from './parse.js';

describe('isValidSlackChannelId', () => {
  it.each([
    ['C01234567', true],
    ['G01234567', true],
    ['D01234567', true],
    ['CABCDEF12', true],
    ['c01234567', false],
    ['X01234567', false],
    ['C0123', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('isValidSlackChannelId(%s) === %s', (id, expected) => {
    expect(isValidSlackChannelId(id as string | null | undefined)).toBe(expected);
  });
});

describe('parseSlackUrl', () => {
  it('parses canonical archives URL', () => {
    const r = parseSlackUrl('https://zuora.slack.com/archives/C0123ABCD');
    expect(r).toEqual({ channelId: 'C0123ABCD', workspace: 'zuora', hasMessageAnchor: false });
  });

  it('parses message-anchor URL but still returns channel', () => {
    const r = parseSlackUrl('https://zuora.slack.com/archives/C0123ABCD/p1700000000123456');
    expect(r?.channelId).toBe('C0123ABCD');
    expect(r?.hasMessageAnchor).toBe(true);
  });

  it('parses enterprise.slack.com URL', () => {
    const r = parseSlackUrl('https://zuora.enterprise.slack.com/archives/G98765ZYXW');
    expect(r?.channelId).toBe('G98765ZYXW');
    expect(r?.workspace).toBe('zuora');
  });

  it('parses app.slack.com client URL', () => {
    const r = parseSlackUrl('https://app.slack.com/client/T0001/C0123ABCD');
    expect(r?.channelId).toBe('C0123ABCD');
    expect(r?.workspace).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    'not a url',
    'http://evil.example.com/archives/C0123ABCD',
    'https://zuora.slack.com/messages/general',
    'https://zuora.slack.com/archives/lowercase01',
    'https://zuora.slack.com/archives/X0123ABCD',
    'slack://channel?team=T1&id=C1',
    'ftp://zuora.slack.com/archives/C0123ABCD',
  ])('rejects invalid input: %s', (input) => {
    expect(parseSlackUrl(input as string | null | undefined)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseSlackUrl('  https://zuora.slack.com/archives/C0123ABCD  ')?.channelId).toBe('C0123ABCD');
  });
});

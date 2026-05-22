import { describe, it, expect } from 'vitest';
import {
  assertSendEnabled,
  isSendEnabled,
  readSendGateConfigFromEnv,
  SendDisabledError,
  type SendGateConfig,
} from './gate.js';

const ON: SendGateConfig = {
  readOnlyMode: false,
  enabled: true,
  botToken: 'xoxb-test',
  userToken: null,
  xoxcToken: null,
  xoxcCookie: null,
  readAuth: { token: 'xoxb-test', cookie: null, kind: 'bot' },
  readToken: 'xoxb-test',
  readTokenKind: 'bot',
  testRecipient: 'U123',
};
const OFF: SendGateConfig = { ...ON, enabled: false };
const NO_TOKEN: SendGateConfig = {
  ...ON,
  botToken: null,
  readAuth: null,
  readToken: null,
  readTokenKind: 'none',
};
const NO_TESTER: SendGateConfig = { ...ON, testRecipient: null };
const READ_ONLY: SendGateConfig = { ...ON, readOnlyMode: true };
const USER_TOKEN_ONLY: SendGateConfig = {
  ...ON,
  botToken: null,
  userToken: 'xoxp-test',
  readAuth: { token: 'xoxp-test', cookie: null, kind: 'user' },
  readToken: 'xoxp-test',
  readTokenKind: 'user',
};
const XOXC_ONLY: SendGateConfig = {
  ...ON,
  botToken: null,
  xoxcToken: 'xoxc-test',
  xoxcCookie: 'xoxd-test',
  readAuth: { token: 'xoxc-test', cookie: 'xoxd-test', kind: 'xoxc' },
  readToken: 'xoxc-test',
  readTokenKind: 'xoxc',
};

describe('send gate', () => {
  it('isSendEnabled requires both flag and token', () => {
    expect(isSendEnabled(ON)).toBe(true);
    expect(isSendEnabled(OFF)).toBe(false);
    expect(isSendEnabled(NO_TOKEN)).toBe(false);
  });

  it('assertSendEnabled allows send when on', () => {
    expect(() => assertSendEnabled('send', ON)).not.toThrow();
    expect(() => assertSendEnabled('test_to_self', ON)).not.toThrow();
  });

  it('assertSendEnabled throws when toggle off (fails closed)', () => {
    expect(() => assertSendEnabled('send', OFF)).toThrowError(SendDisabledError);
    try {
      assertSendEnabled('send', OFF);
    } catch (e) {
      expect((e as SendDisabledError).code).toBe('send-disabled');
    }
  });

  it('assertSendEnabled throws when bot token missing', () => {
    expect(() => assertSendEnabled('send', NO_TOKEN)).toThrowError(/SLACK_BOT_TOKEN/);
  });

  it('assertSendEnabled throws on test_to_self when no recipient', () => {
    expect(() => assertSendEnabled('test_to_self', NO_TESTER)).toThrowError(/SLACK_TEST_USER_ID/);
    // Customer send doesn't need the tester to be configured.
    expect(() => assertSendEnabled('send', NO_TESTER)).not.toThrow();
  });

  it('SLACK_READ_ONLY_MODE blocks ALL sends and beats everything else', () => {
    expect(isSendEnabled(READ_ONLY)).toBe(false);
    expect(() => assertSendEnabled('send', READ_ONLY)).toThrowError(SendDisabledError);
    expect(() => assertSendEnabled('test_to_self', READ_ONLY)).toThrowError(/SLACK_READ_ONLY_MODE/);
    try {
      assertSendEnabled('send', READ_ONLY);
    } catch (e) {
      expect((e as SendDisabledError).code).toBe('read-only-mode');
    }
  });

  it('read-only-mode check fires BEFORE missing-token/missing-tester checks', () => {
    const readOnlyAndBroken: SendGateConfig = {
      readOnlyMode: true,
      enabled: false,
      botToken: null,
      userToken: null,
      xoxcToken: null,
      xoxcCookie: null,
      readAuth: null,
      readToken: null,
      readTokenKind: 'none',
      testRecipient: null,
    };
    try {
      assertSendEnabled('test_to_self', readOnlyAndBroken);
      expect.fail('should have thrown');
    } catch (e) {
      // The read-only error should win even though every other guard
      // would also fail — gives unambiguous audit-log codes.
      expect((e as SendDisabledError).code).toBe('read-only-mode');
    }
  });

  it('USER token is NOT accepted for sends (would post as the user personally)', () => {
    // Even with everything else green, a user-token-only config must
    // fail the send gate because botToken is null.
    expect(isSendEnabled(USER_TOKEN_ONLY)).toBe(false);
    expect(() => assertSendEnabled('send', USER_TOKEN_ONLY)).toThrowError(/SLACK_BOT_TOKEN/);
    try {
      assertSendEnabled('send', USER_TOKEN_ONLY);
    } catch (e) {
      expect((e as SendDisabledError).code).toBe('no-bot-token');
      // Error message should explicitly call out that user tokens
      // aren't a substitute, so operators don't waste time guessing.
      expect((e as SendDisabledError).message).toMatch(/SLACK_USER_TOKEN/);
    }
  });

  it('USER token IS surfaced as the readToken for read-only API calls', () => {
    // The whole point of accepting xoxp- is read-only mapping work
    // unblocking when bot install requires admin approval.
    expect(USER_TOKEN_ONLY.readToken).toBe('xoxp-test');
    expect(USER_TOKEN_ONLY.readTokenKind).toBe('user');
  });

  it('readSendGateConfigFromEnv: bot token wins over user token when both set', () => {
    const orig = { bot: process.env.SLACK_BOT_TOKEN, usr: process.env.SLACK_USER_TOKEN };
    try {
      process.env.SLACK_BOT_TOKEN = 'xoxb-real';
      process.env.SLACK_USER_TOKEN = 'xoxp-real';
      const cfg = readSendGateConfigFromEnv();
      expect(cfg.readToken).toBe('xoxb-real');
      expect(cfg.readTokenKind).toBe('bot');
    } finally {
      process.env.SLACK_BOT_TOKEN = orig.bot;
      process.env.SLACK_USER_TOKEN = orig.usr;
    }
  });

  it('readSendGateConfigFromEnv: falls back to user token when bot absent', () => {
    const orig = { bot: process.env.SLACK_BOT_TOKEN, usr: process.env.SLACK_USER_TOKEN };
    try {
      delete process.env.SLACK_BOT_TOKEN;
      process.env.SLACK_USER_TOKEN = 'xoxp-real';
      const cfg = readSendGateConfigFromEnv();
      expect(cfg.readToken).toBe('xoxp-real');
      expect(cfg.readTokenKind).toBe('user');
      expect(cfg.botToken).toBeNull();
    } finally {
      process.env.SLACK_BOT_TOKEN = orig.bot;
      process.env.SLACK_USER_TOKEN = orig.usr;
    }
  });

  it('XOXC token is HARD-REJECTED for sends (would post as the user personally)', () => {
    expect(isSendEnabled(XOXC_ONLY)).toBe(false);
    expect(() => assertSendEnabled('send', XOXC_ONLY)).toThrowError(/SLACK_XOXC_TOKEN/);
    try {
      assertSendEnabled('send', XOXC_ONLY);
    } catch (e) {
      expect((e as SendDisabledError).code).toBe('no-bot-token');
      // Error message must explicitly mention xoxc, TOS, and audit logs
      // so operators understand WHY swapping in a bot token matters.
      expect((e as SendDisabledError).message).toMatch(/SLACK_XOXC_TOKEN/);
      expect((e as SendDisabledError).message).toMatch(/TOS/);
      expect((e as SendDisabledError).message).toMatch(/audit log/);
    }
  });

  it('XOXC IS surfaced as readAuth with the matching cookie', () => {
    expect(XOXC_ONLY.readAuth).toEqual({
      token: 'xoxc-test',
      cookie: 'xoxd-test',
      kind: 'xoxc',
    });
  });

  it('readSendGateConfigFromEnv: precedence is bot > user > xoxc', () => {
    const orig = {
      bot: process.env.SLACK_BOT_TOKEN,
      usr: process.env.SLACK_USER_TOKEN,
      xc: process.env.SLACK_XOXC_TOKEN,
      xd: process.env.SLACK_XOXD_COOKIE,
    };
    try {
      // All three present → bot wins.
      process.env.SLACK_BOT_TOKEN = 'xoxb-1';
      process.env.SLACK_USER_TOKEN = 'xoxp-1';
      process.env.SLACK_XOXC_TOKEN = 'xoxc-1';
      process.env.SLACK_XOXD_COOKIE = 'xoxd-1';
      let cfg = readSendGateConfigFromEnv();
      expect(cfg.readTokenKind).toBe('bot');
      expect(cfg.readToken).toBe('xoxb-1');

      // Only user + xoxc → user wins.
      delete process.env.SLACK_BOT_TOKEN;
      cfg = readSendGateConfigFromEnv();
      expect(cfg.readTokenKind).toBe('user');
      expect(cfg.readToken).toBe('xoxp-1');

      // Only xoxc + cookie → xoxc wins.
      delete process.env.SLACK_USER_TOKEN;
      cfg = readSendGateConfigFromEnv();
      expect(cfg.readTokenKind).toBe('xoxc');
      expect(cfg.readAuth).toEqual({
        token: 'xoxc-1',
        cookie: 'xoxd-1',
        kind: 'xoxc',
      });
    } finally {
      process.env.SLACK_BOT_TOKEN = orig.bot;
      process.env.SLACK_USER_TOKEN = orig.usr;
      process.env.SLACK_XOXC_TOKEN = orig.xc;
      process.env.SLACK_XOXD_COOKIE = orig.xd;
    }
  });

  it('readSendGateConfigFromEnv: xoxc WITHOUT cookie does not activate (Slack rejects xoxc-without-cookie)', () => {
    const orig = {
      bot: process.env.SLACK_BOT_TOKEN,
      usr: process.env.SLACK_USER_TOKEN,
      xc: process.env.SLACK_XOXC_TOKEN,
      xd: process.env.SLACK_XOXD_COOKIE,
    };
    try {
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_USER_TOKEN;
      process.env.SLACK_XOXC_TOKEN = 'xoxc-orphan';
      delete process.env.SLACK_XOXD_COOKIE;
      const cfg = readSendGateConfigFromEnv();
      expect(cfg.xoxcToken).toBe('xoxc-orphan');
      expect(cfg.xoxcCookie).toBeNull();
      // Slack rejects xoxc-without-cookie with invalid_auth, so we
      // refuse to construct readAuth in that case. UI surfaces this
      // as "INCOMPLETE" in the gate panel.
      expect(cfg.readAuth).toBeNull();
      expect(cfg.readTokenKind).toBe('none');
    } finally {
      process.env.SLACK_BOT_TOKEN = orig.bot;
      process.env.SLACK_USER_TOKEN = orig.usr;
      process.env.SLACK_XOXC_TOKEN = orig.xc;
      process.env.SLACK_XOXD_COOKIE = orig.xd;
    }
  });
});

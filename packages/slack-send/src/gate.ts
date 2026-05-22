// Hard send-gate.
//
// Three independent guards. ALL must pass for a real send to go out;
// ANY failing one blocks. Belt-and-suspenders by design.
//
//   1. SLACK_READ_ONLY_MODE  — phase-1a kill switch. When set to the
//      literal string "true" (case-insensitive), ALL sends are blocked
//      regardless of any other config. This exists so the mapping work
//      can run with a bot/user token (which it needs for channels:read /
//      conversations.info) without ANY possibility of triggering a
//      chat.postMessage. Default: unset → off → not blocking.
//      Set to "true" for phase 1a; remove or set to "false" for 1b.
//
//   2. ENABLE_SLACK_SEND      — the original master toggle. Must be the
//      literal "true" to allow sends. Default: unset → off → blocking.
//
//   3. SLACK_BOT_TOKEN        — required for any REAL SEND. User tokens
//      (xoxp-) are deliberately NOT accepted for sending because:
//        a) sends would appear to come from the human personally, which
//           is wrong for an automated CSE tool, and
//        b) blast radius of a leaked user token is the whole user's
//           access, not a scoped bot.
//      For read-only calls a user token IS acceptable — see
//      `readToken` below.
//
// The send code path checks all three. Preview is NEVER gated: previews
// are pure rendering, do not call Slack, and are explicitly allowed when
// sends are blocked so the user can still see what would be sent.
//
// Read-only Slack API calls (conversations.list, conversations.info,
// auth.test) use `readToken` instead of `botToken`. `readToken` prefers
// a bot token when set, otherwise falls back to SLACK_USER_TOKEN
// (xoxp-). This unblocks mapping work in workspaces where admin approval
// for a bot app is required but a user-scoped install is permitted.
// SLACK_READ_ONLY_MODE does NOT block reads — it only blocks sends.
// That's the whole point of phase 1a.

export class SendDisabledError extends Error {
  readonly code:
    | 'read-only-mode'
    | 'send-disabled'
    | 'no-bot-token'
    | 'no-test-recipient';
  constructor(code: SendDisabledError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'SendDisabledError';
  }
}

export type ReadTokenKind = 'bot' | 'user' | 'xoxc' | 'none';

/**
 * Bundle of auth material needed for a read-only Slack API call. For
 * xoxb-/xoxp- tokens, cookie is null and the Authorization header is
 * sufficient. For xoxc- (browser-session) tokens, Slack requires the
 * matching `d` cookie or the request returns `invalid_auth`.
 */
export interface ReadAuth {
  token: string;
  cookie: string | null;
  kind: ReadTokenKind;
}

export interface SendGateConfig {
  /**
   * Phase-1a kill switch. When true, ALL sends are blocked regardless
   * of other config. Default false.
   */
  readOnlyMode: boolean;
  /** Master send toggle. Defaults to false. */
  enabled: boolean;
  /**
   * Slack bot token (xoxb-…). Required for any real SEND.
   * User tokens are deliberately not accepted here.
   */
  botToken: string | null;
  /**
   * Slack user token (xoxp-…). Acceptable for read-only API calls only.
   * Never used for chat.postMessage — see assertSendEnabled.
   */
  userToken: string | null;
  /**
   * Browser-session token (xoxc-…) scraped from your own logged-in
   * Slack web client. Acceptable for read-only API calls only. Requires
   * `xoxcCookie` to be set too — Slack rejects xoxc requests without
   * the matching `d` cookie.
   *
   * Last-resort fallback when admin approval is required for every app
   * install. NEVER used for chat.postMessage. See README + .env.example
   * for the security implications.
   */
  xoxcToken: string | null;
  /** Value of the `d` cookie from slack.com. Paired with xoxcToken. */
  xoxcCookie: string | null;
  /**
   * Resolved auth for read-only Slack API calls. Preference order:
   *   1. bot token       (xoxb-, sanctioned, lowest blast radius)
   *   2. user token      (xoxp-, sanctioned by you but acts as you)
   *   3. browser xoxc    (unsanctioned, TOS gray area, full user impersonation)
   *   4. null            (no Slack API access)
   */
  readAuth: ReadAuth | null;
  /**
   * @deprecated use `readAuth.token` — kept for compatibility while
   * existing call sites migrate. Equal to `readAuth?.token ?? null`.
   */
  readToken: string | null;
  /** Which token readAuth came from (for UI labelling / warnings). */
  readTokenKind: ReadTokenKind;
  /**
   * Test-mode recipient: either a Slack user-id (Uxxx) or a pre-opened
   * DM channel-id (Dxxx).
   */
  testRecipient: string | null;
}

export function readSendGateConfigFromEnv(): SendGateConfig {
  const readOnlyMode =
    String(process.env.SLACK_READ_ONLY_MODE ?? '').trim().toLowerCase() === 'true';
  const enabled = String(process.env.ENABLE_SLACK_SEND ?? '').trim().toLowerCase() === 'true';
  const botToken = (process.env.SLACK_BOT_TOKEN ?? '').trim() || null;
  const userToken = (process.env.SLACK_USER_TOKEN ?? '').trim() || null;
  const xoxcToken = (process.env.SLACK_XOXC_TOKEN ?? '').trim() || null;
  const xoxcCookie = (process.env.SLACK_XOXD_COOKIE ?? '').trim() || null;
  const testRecipient = (process.env.SLACK_TEST_USER_ID ?? '').trim() || null;

  // Build readAuth in precedence order. xoxc is only valid when BOTH
  // token AND cookie are present — Slack rejects xoxc without the cookie.
  let readAuth: ReadAuth | null = null;
  if (botToken) {
    readAuth = { token: botToken, cookie: null, kind: 'bot' };
  } else if (userToken) {
    readAuth = { token: userToken, cookie: null, kind: 'user' };
  } else if (xoxcToken && xoxcCookie) {
    readAuth = { token: xoxcToken, cookie: xoxcCookie, kind: 'xoxc' };
  }

  return {
    readOnlyMode,
    enabled,
    botToken,
    userToken,
    xoxcToken,
    xoxcCookie,
    readAuth,
    readToken: readAuth?.token ?? null,
    readTokenKind: readAuth?.kind ?? 'none',
    testRecipient,
  };
}

export function isSendEnabled(cfg: SendGateConfig = readSendGateConfigFromEnv()): boolean {
  return !cfg.readOnlyMode && cfg.enabled && !!cfg.botToken;
}

/**
 * Throws SendDisabledError if a real send (customer or test-to-self) is
 * not permitted. Call this at the top of every send path; preview paths
 * MUST NOT call this.
 *
 * Check order: read-only mode is checked FIRST so its error code is
 * unambiguous in audit logs.
 */
export function assertSendEnabled(
  mode: 'send' | 'test_to_self',
  cfg: SendGateConfig = readSendGateConfigFromEnv(),
): void {
  if (cfg.readOnlyMode) {
    throw new SendDisabledError(
      'read-only-mode',
      'SLACK_READ_ONLY_MODE is "true". This deployment is in read-only mode (phase 1a); ' +
        'all Slack sends are blocked. Remove SLACK_READ_ONLY_MODE to advance to phase 1b.',
    );
  }
  if (!cfg.enabled) {
    throw new SendDisabledError(
      'send-disabled',
      'ENABLE_SLACK_SEND is not "true". Real sends are blocked. Preview-only.',
    );
  }
  if (!cfg.botToken) {
    const altReason =
      cfg.readTokenKind === 'xoxc'
        ? ' Note: SLACK_XOXC_TOKEN (browser session) is HARD-REJECTED for sending — sends would post from your personal account, violate Slack TOS, and be visible to your workspace admin in audit logs.'
        : cfg.readTokenKind === 'user'
          ? ' Note: SLACK_USER_TOKEN is intentionally NOT accepted for sends — sends would appear to come from the user personally, and blast radius is too wide.'
          : '';
    throw new SendDisabledError(
      'no-bot-token',
      'SLACK_BOT_TOKEN is not set. Cannot reach Slack API for sending.' + altReason,
    );
  }
  if (mode === 'test_to_self' && !cfg.testRecipient) {
    throw new SendDisabledError(
      'no-test-recipient',
      'SLACK_TEST_USER_ID is not set. Configure a DM target before using test-to-self mode.',
    );
  }
}

export function getTestRecipient(cfg: SendGateConfig = readSendGateConfigFromEnv()): string | null {
  return cfg.testRecipient;
}

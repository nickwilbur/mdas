import { NextResponse } from 'next/server';
import { readSendGateConfigFromEnv } from '@mdas/slack-send';
import { audit } from '@mdas/db';
import { assertXoxcSafetyOrThrow, XoxcSafetyError } from '@/lib/xoxc-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Minimal Slack auth.test wrapper. Read-only; calls auth.test ONCE and
// returns:
//   { ok, botUserId, team, teamId, url, scopes }
//
// No tokens, no secrets, no message bodies. Used to verify the bot
// token works before triggering a full refresh.
//
// auth.test is the canonical "is this token live and what is it?" call
// in Slack's API. It does NOT require any scope to succeed — Slack
// always returns the token's own identity. We surface the response
// header `x-oauth-scopes` so you can see the EXACT scopes the bot has
// (helpful when the admin's install differs from what you requested).
//
// This endpoint is intentionally OUTSIDE the send-gate guards because
// it's a read-only sanity check. SLACK_READ_ONLY_MODE does NOT block
// it — it only blocks sends.
export async function GET(): Promise<Response> {
  const cfg = readSendGateConfigFromEnv();
  if (cfg.readTokenKind === 'xoxc') {
    try {
      assertXoxcSafetyOrThrow();
    } catch (e) {
      if (e instanceof XoxcSafetyError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
      }
      throw e;
    }
  }
  if (!cfg.readAuth) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'No Slack auth configured. Set one of: SLACK_BOT_TOKEN, SLACK_USER_TOKEN, or SLACK_XOXC_TOKEN+SLACK_XOXD_COOKIE.',
      },
      { status: 503 },
    );
  }

  // xoxc requires the matching `d` cookie alongside the Bearer header,
  // or Slack returns invalid_auth. Other token kinds ignore Cookie.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.readAuth.token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (cfg.readAuth.cookie) {
    headers.Cookie = `d=${cfg.readAuth.cookie}`;
  }

  let res: Response;
  try {
    res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `network: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Slack auth.test HTTP ${res.status}` },
      { status: 502 },
    );
  }

  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    user_id?: string;
    user?: string;
    team_id?: string;
    team?: string;
    url?: string;
    bot_id?: string;
  };

  // Slack returns granted scopes in this response header.
  const scopes = res.headers.get('x-oauth-scopes') ?? '';

  await audit('manual:nick', 'slack.auth-test', {
    ok: body.ok,
    tokenKind: cfg.readTokenKind,
    teamId: body.team_id,
    userId: body.user_id,
    scopes,
    error: body.error,
  });

  if (!body.ok) {
    return NextResponse.json(
      {
        ok: false,
        tokenKind: cfg.readTokenKind,
        error: body.error ?? 'unknown',
        scopes,
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    tokenKind: cfg.readTokenKind, // 'bot' | 'user'
    botUserId: body.user_id,
    botUser: body.user,
    botId: body.bot_id,
    team: body.team,
    teamId: body.team_id,
    url: body.url,
    scopes: scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

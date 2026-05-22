'use client';

import { useCallback, useState } from 'react';

type TokenKind = 'bot' | 'user' | 'xoxc' | 'none';

interface AuthTestOk {
  ok: true;
  tokenKind: TokenKind;
  botUserId: string;
  botUser: string;
  botId?: string;
  team: string;
  teamId: string;
  url: string;
  scopes: string[];
}
interface AuthTestErr {
  ok: false;
  tokenKind?: TokenKind;
  error: string;
  scopes?: string;
}
type AuthTestResult = AuthTestOk | AuthTestErr;

export function AuthTestButton(): JSX.Element {
  const [result, setResult] = useState<AuthTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/slack/auth-test');
      const j = (await r.json()) as AuthTestResult;
      setResult(j);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="mt-3">
      <button
        onClick={run}
        disabled={busy}
        className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Testing…' : 'Verify Slack token (auth.test)'}
      </button>
      {result?.ok === true ? (
        <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
          <div className="font-semibold">
            ✓ Token valid (
            {result.tokenKind === 'xoxc'
              ? 'BROWSER-SESSION token — xoxc'
              : result.tokenKind === 'user'
                ? 'USER token — xoxp'
                : 'BOT token — xoxb'}
            )
          </div>
          <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-y-0.5">
            <dt className="text-gray-600">{result.tokenKind === 'user' ? 'User:' : 'Bot user:'}</dt>
            <dd className="font-mono">@{result.botUser} ({result.botUserId})</dd>
            <dt className="text-gray-600">Team:</dt>
            <dd>{result.team} ({result.teamId})</dd>
            <dt className="text-gray-600">URL:</dt>
            <dd className="truncate font-mono">{result.url}</dd>
            <dt className="text-gray-600">Scopes:</dt>
            <dd>
              {result.scopes.length === 0 ? (
                <em>none reported in header (token still works but Slack didn't return X-OAuth-Scopes)</em>
              ) : (
                <span className="font-mono">{result.scopes.join(', ')}</span>
              )}
            </dd>
          </dl>
          {result.scopes.length > 0 && !result.scopes.includes('channels:read') ? (
            <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-amber-900">
              Warning: <code>channels:read</code> is NOT in the granted scopes.
              The mapping refresh will not be able to list public channels.
              {result.tokenKind === 'user' ? ' Re-install the app under User Token Scopes.' : ' Ask the admin to add it.'}
            </div>
          ) : null}
          {result.tokenKind === 'user' ? (
            <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-amber-900">
              This is a USER token. It can read public channels for the mapping refresh,
              but the send-gate will REJECT it for chat.postMessage (sends would
              appear to come from {result.botUser} personally).
            </div>
          ) : null}
          {result.tokenKind === 'xoxc' ? (
            <div className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-red-900">
              This is a BROWSER-SESSION token for @{result.botUser}. Slack does NOT
              return granted scopes for xoxc tokens — it has whatever you have in
              the Slack web client. The send-gate hard-rejects chat.postMessage
              under this token. Token will rotate on session refresh; expect to
              re-paste from devtools periodically.
            </div>
          ) : null}
        </div>
      ) : null}
      {result?.ok === false ? (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
          <div className="font-semibold">✗ Token rejected</div>
          <div className="mt-1 font-mono">{result.error}</div>
          {result.scopes ? (
            <div className="mt-1 text-gray-700">Granted scopes: {result.scopes}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

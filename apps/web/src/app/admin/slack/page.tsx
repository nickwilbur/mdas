import { Card } from '@/components/ui';
import { listMappings } from '@/lib/slack-mapping';
import { readSendGateConfigFromEnv } from '@mdas/slack-send';
import { assertXoxcSafetyOrThrow } from '@/lib/xoxc-safety';
import { SlackMappingsClient } from './SlackMappingsClient';
import { AuthTestButton } from './AuthTestButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  mapped: 'bg-emerald-100 text-emerald-800',
  manually_overridden: 'bg-indigo-100 text-indigo-800',
  missing_salesforce_channel: 'bg-amber-100 text-amber-800',
  invalid_slack_url: 'bg-red-100 text-red-800',
  inaccessible_channel: 'bg-red-100 text-red-800',
  unresolved: 'bg-gray-200 text-gray-800',
  heuristic_candidate: 'bg-sky-100 text-sky-800',
};

const DEFAULT_PAGE_SIZE = 50;

export default async function AdminSlackPage(): Promise<JSX.Element> {
  // Initial server-rendered page: first 50 rows + unfiltered counts. The
  // client then re-fetches when the user changes page / filter / search,
  // so the browser only ever holds one page in memory.
  const initial = await listMappings({ page: 1, pageSize: DEFAULT_PAGE_SIZE });

  // Read env on the server only — never echo botToken/recipient value
  // to the client. We only surface booleans + label.
  const gate = readSendGateConfigFromEnv();
  // When xoxc is configured, hard-fail at request time if .env is
  // git-tracked or .gitignore is missing entries. Belt-and-suspenders.
  if (gate.readTokenKind === 'xoxc') {
    assertXoxcSafetyOrThrow();
  }
  const gateInfo = {
    sendEnabled: !gate.readOnlyMode && gate.enabled && !!gate.botToken,
    readOnlyMode: gate.readOnlyMode,
    flagSet: gate.enabled,
    botTokenPresent: !!gate.botToken,
    userTokenPresent: !!gate.userToken,
    xoxcTokenPresent: !!gate.xoxcToken && !!gate.xoxcCookie,
    xoxcPartial: (!!gate.xoxcToken && !gate.xoxcCookie) || (!gate.xoxcToken && !!gate.xoxcCookie),
    readTokenKind: gate.readTokenKind, // 'bot' | 'user' | 'xoxc' | 'none'
    testRecipientPresent: !!gate.testRecipient,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customer Slack Channels</h1>
          <p className="mt-1 text-sm text-gray-600">
            Expand 3 → internal Slack channel mapping, sourced from
            Salesforce <code>Internal_Customer_Slack_Channel__c</code>.
            Gaps are surfaced explicitly. Real sends require an explicit
            env toggle and per-message confirmation.
          </p>
        </div>
      </div>

      <Card title="Send gate (three independent guards — ALL must pass for a real send)">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <GateRow
            label="SLACK_READ_ONLY_MODE"
            value={gateInfo.readOnlyMode ? 'true (phase 1a)' : 'unset'}
            // For this row, "ok" means "actively blocking" — green
            // because in phase 1a we WANT this on.
            ok={gateInfo.readOnlyMode}
            invertOk
          />
          <GateRow
            label="ENABLE_SLACK_SEND"
            value={gateInfo.flagSet ? 'true' : 'false (default)'}
            ok={gateInfo.flagSet}
          />
          <GateRow
            label="SLACK_BOT_TOKEN"
            value={gateInfo.botTokenPresent ? 'present' : 'missing'}
            ok={gateInfo.botTokenPresent}
          />
          <GateRow
            label="SLACK_USER_TOKEN"
            value={
              gateInfo.userTokenPresent
                ? gateInfo.botTokenPresent
                  ? 'present (unused — bot wins)'
                  : 'present (read-only fallback)'
                : 'missing'
            }
            ok={gateInfo.userTokenPresent}
          />
          <GateRow
            label="SLACK_XOXC_TOKEN"
            value={
              gateInfo.xoxcPartial
                ? 'INCOMPLETE — need both TOKEN + COOKIE'
                : gateInfo.xoxcTokenPresent
                  ? gate.readTokenKind === 'xoxc'
                    ? 'IN USE — browser session (TOS gray area)'
                    : 'present (unused — bot/user wins)'
                  : 'missing'
            }
            ok={gateInfo.xoxcTokenPresent}
            danger={gate.readTokenKind === 'xoxc'}
          />
          <GateRow
            label="SLACK_TEST_USER_ID"
            value={gateInfo.testRecipientPresent ? 'present' : 'missing'}
            ok={gateInfo.testRecipientPresent}
          />
        </div>
        <p className="mt-3 text-xs text-gray-600">
          {gateInfo.readOnlyMode
            ? `PHASE 1a — read-only mode is ON. Real sends are BLOCKED at the gate regardless of any other config. The ${gateInfo.readTokenKind === 'user' ? 'USER token (xoxp-)' : gateInfo.readTokenKind === 'bot' ? 'bot token (xoxb-)' : 'token (none configured)'} is used ONLY for read-only Slack API calls (conversations.list / conversations.info / auth.test).`
            : gateInfo.sendEnabled
              ? 'Real sends are ENABLED. Preview + confirm flow will deliver to Slack.'
              : 'Real sends are BLOCKED. Preview-only — confirm will record a blocked audit row but no Slack call.'}
        </p>
        {gateInfo.readTokenKind === 'user' ? (
          <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
            <strong>User token in use.</strong> Read-only mapping works, but
            sends will never be permitted with a user token (would post as
            you personally). To enable sends, install the Slack app with a
            bot token (admin approval required).
          </p>
        ) : null}
        {gateInfo.readTokenKind === 'xoxc' ? (
          <p className="mt-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900">
            <strong>BROWSER-SESSION TOKEN IN USE — last-resort fallback.</strong>{' '}
            Read-only mapping works under your personal Slack account.{' '}
            Risks: against Slack TOS §4 · visible to your workspace admin in audit logs ·{' '}
            blast radius = your full Slack access · token rotates on session refresh ·{' '}
            machine-locked (will not work in CI or for teammates).{' '}
            Sends (chat.postMessage) are hard-rejected by the gate.{' '}
            Swap for SLACK_BOT_TOKEN once admin approval lands — it's a one-line env change.
          </p>
        ) : null}
        {gateInfo.readTokenKind !== 'none' ? (
          <AuthTestButton />
        ) : (
          <p className="mt-2 text-xs italic text-gray-500">
            Add SLACK_BOT_TOKEN, SLACK_USER_TOKEN, or SLACK_XOXC_TOKEN+SLACK_XOXD_COOKIE to .env to enable Slack-API name validation. Verify with the auth-test button.
          </p>
        )}
      </Card>

      <SlackMappingsClient
        initialRows={initial.rows}
        initialTotal={initial.total}
        initialCounts={initial.counts}
        initialPage={initial.page}
        pageSize={DEFAULT_PAGE_SIZE}
        statusColors={STATUS_COLORS}
        sendEnabled={gateInfo.sendEnabled}
        testRecipientConfigured={gateInfo.testRecipientPresent}
      />
    </div>
  );
}

function GateRow({
  label,
  value,
  ok,
  invertOk,
  danger,
}: {
  label: string;
  value: string;
  ok: boolean;
  /** When true, render the "ok" state in safety-green even if `ok=false`. Used for read-only mode where "blocking" is the desired state in phase 1a. */
  invertOk?: boolean;
  /** When true, render the value in red even if ok is true — used for risky auth like xoxc. */
  danger?: boolean;
}): JSX.Element {
  const greenPositive = !invertOk && ok;
  const greenSafety = invertOk && ok;
  const cls = danger
    ? 'bg-red-100 text-red-800'
    : greenPositive || greenSafety
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-gray-200 text-gray-700';
  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-2 ${danger ? 'border-red-300' : 'border-gray-200'}`}
    >
      <div className="text-xs font-medium text-gray-700">{label}</div>
      <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{value}</span>
    </div>
  );
}

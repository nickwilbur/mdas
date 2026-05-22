// Server-only Slack send service. Orchestrates preview + confirm + send
// against the durable mapping and the slack_message_audit table.
//
// Flow contract:
//
//   1. previewSend({...})
//      - validates mapping (fail-closed on missing/invalid for real sends;
//        test-to-self preview allowed even with no mapping)
//      - writes an audit row with mode='preview' or mode='test_to_self'
//        and result='previewed'
//      - returns the audit row id; the UI must pass it back on confirm
//
//   2. confirmSend({ previewId, actor })
//      - looks up the preview row by id
//      - re-checks the hard send gate (no caching)
//      - calls Slack chat.postMessage exactly once
//      - writes a NEW audit row with result='sent' | 'failed' | 'blocked'
//        and preview_of=<previewId> — this row is the proof of action
//
//   3. cancelSend({ previewId, actor })
//      - writes a NEW audit row with result='cancelled' and
//        preview_of=<previewId>. No Slack side effect.
//
// Single-target only: the API accepts one accountId per preview and one
// previewId per confirm. There is no list parameter anywhere.

import 'server-only';
import { query, audit } from '@mdas/db';
import {
  postMessage,
  readSendGateConfigFromEnv,
  assertSendEnabled,
  SendDisabledError,
  SlackApiError,
  isValidSlackChannelId,
} from '@mdas/slack-send';
import { getMapping } from './slack-mapping.js';

export interface PreviewInput {
  accountId: string;
  messageBody: string;
  /**
   * customer_channel — preview targets the mapped customer Slack channel.
   * self_test       — preview targets the configured test recipient (DM).
   */
  targetType: 'customer_channel' | 'self_test';
  actor: string;
}

export interface PreviewResult {
  previewId: string;
  targetType: 'customer_channel' | 'self_test';
  targetSlackIdOrChannel: string | null;
  accountName: string | null;
  messageBody: string;
  /** True when a confirmed send would actually go out (gate on + mapping valid). */
  sendAllowed: boolean;
  /** Human-readable explanation when sendAllowed === false. */
  blockedReason: string | null;
}

export async function previewSend(input: PreviewInput): Promise<PreviewResult> {
  if (!input.messageBody || !input.messageBody.trim()) {
    throw new Error('Message body is required.');
  }

  const mapping = await getMapping(input.accountId);
  const accountName = mapping?.accountName ?? null;

  const cfg = readSendGateConfigFromEnv();
  let targetSlackIdOrChannel: string | null = null;
  let sendAllowed = true;
  let blockedReason: string | null = null;

  if (input.targetType === 'self_test') {
    targetSlackIdOrChannel = cfg.testRecipient;
    if (!cfg.testRecipient) {
      sendAllowed = false;
      blockedReason = 'SLACK_TEST_USER_ID is not configured.';
    }
  } else {
    // customer_channel
    if (!mapping || !mapping.slackChannelId || !isValidSlackChannelId(mapping.slackChannelId)) {
      sendAllowed = false;
      blockedReason = `No usable customer channel mapping (status=${mapping?.status ?? 'no-row'}).`;
      targetSlackIdOrChannel = null;
    } else {
      targetSlackIdOrChannel = mapping.slackChannelId;
    }
  }

  if (sendAllowed) {
    if (!cfg.enabled) {
      sendAllowed = false;
      blockedReason = 'ENABLE_SLACK_SEND is not "true". Real sends are blocked.';
    } else if (!cfg.botToken) {
      sendAllowed = false;
      blockedReason = 'SLACK_BOT_TOKEN is not set.';
    }
  }

  const auditMode = input.targetType === 'self_test' ? 'test_to_self' : 'preview';

  const r = await query<{ id: string }>(
    `INSERT INTO slack_message_audit
       (account_id, mode, target_type, target_slack_id_or_channel,
        message_body, result, failure_reason)
     VALUES ($1,$2,$3,$4,$5,'previewed',$6) RETURNING id`,
    [
      input.accountId,
      auditMode,
      input.targetType,
      targetSlackIdOrChannel,
      input.messageBody,
      blockedReason,
    ],
  );
  const previewId = r.rows[0]!.id;

  await audit(input.actor, 'slack.send.preview', {
    previewId,
    accountId: input.accountId,
    targetType: input.targetType,
    sendAllowed,
    blockedReason,
  });

  return {
    previewId,
    targetType: input.targetType,
    targetSlackIdOrChannel,
    accountName,
    messageBody: input.messageBody,
    sendAllowed,
    blockedReason,
  };
}

export interface ConfirmInput {
  previewId: string;
  actor: string;
}

export interface ConfirmResult {
  ok: boolean;
  auditId: string;
  result: 'sent' | 'blocked' | 'failed';
  failureReason: string | null;
  ts?: string;
}

interface PreviewRow {
  id: string;
  account_id: string;
  mode: 'preview' | 'test_to_self' | 'send';
  target_type: 'customer_channel' | 'self_test';
  target_slack_id_or_channel: string | null;
  message_body: string;
  result: string;
  failure_reason: string | null;
  preview_of: string | null;
}

export async function confirmSend(input: ConfirmInput): Promise<ConfirmResult> {
  // 1. Locate the preview row. Reject re-use across messages: a row can be
  //    confirmed at most once. We check that no prior send/blocked/cancelled
  //    row already references this previewId.
  const pr = await query<PreviewRow>(
    `SELECT * FROM slack_message_audit WHERE id = $1`,
    [input.previewId],
  );
  const preview = pr.rows[0];
  if (!preview) throw new Error(`Preview ${input.previewId} not found.`);
  if (preview.result !== 'previewed') {
    throw new Error(`Preview ${input.previewId} is not in 'previewed' state (was ${preview.result}).`);
  }
  const reused = await query<{ id: string }>(
    `SELECT id FROM slack_message_audit WHERE preview_of = $1 LIMIT 1`,
    [input.previewId],
  );
  if (reused.rows[0]) {
    throw new Error(`Preview ${input.previewId} has already been acted on.`);
  }

  const cfg = readSendGateConfigFromEnv();
  const mode = preview.target_type === 'self_test' ? 'test_to_self' : 'send';

  // 2. Re-check the gate (no caching of preview-time decision).
  try {
    assertSendEnabled(mode, cfg);
  } catch (e) {
    const reason = e instanceof SendDisabledError ? e.message : String(e);
    const auditRow = await insertAuditRow({
      accountId: preview.account_id,
      mode,
      targetType: preview.target_type,
      targetSlackIdOrChannel: preview.target_slack_id_or_channel,
      messageBody: preview.message_body,
      confirmedBy: input.actor,
      result: 'blocked',
      failureReason: reason,
      previewOf: preview.id,
    });
    await audit(input.actor, 'slack.send.blocked', {
      previewId: preview.id,
      auditId: auditRow,
      reason,
    });
    return { ok: false, auditId: auditRow, result: 'blocked', failureReason: reason };
  }

  // 3. Channel must be present at confirm time. If a preview was recorded
  //    with no channel (e.g. test-to-self before SLACK_TEST_USER_ID was
  //    set, then env changed) we re-resolve to the live test recipient.
  const channel =
    preview.target_type === 'self_test'
      ? cfg.testRecipient
      : preview.target_slack_id_or_channel;
  if (!channel) {
    const reason = 'No target channel available at confirm time.';
    const auditRow = await insertAuditRow({
      accountId: preview.account_id,
      mode,
      targetType: preview.target_type,
      targetSlackIdOrChannel: null,
      messageBody: preview.message_body,
      confirmedBy: input.actor,
      result: 'blocked',
      failureReason: reason,
      previewOf: preview.id,
    });
    return { ok: false, auditId: auditRow, result: 'blocked', failureReason: reason };
  }

  // 4. Send.
  try {
    const r = await postMessage({
      botToken: cfg.botToken!,
      channel,
      text:
        preview.target_type === 'self_test'
          ? `[TEST MODE — redirected from customer channel] ` + preview.message_body
          : preview.message_body,
    });
    const auditRow = await insertAuditRow({
      accountId: preview.account_id,
      mode,
      targetType: preview.target_type,
      targetSlackIdOrChannel: channel,
      messageBody: preview.message_body,
      confirmedBy: input.actor,
      result: 'sent',
      failureReason: null,
      previewOf: preview.id,
    });
    await audit(input.actor, 'slack.send.sent', {
      previewId: preview.id,
      auditId: auditRow,
      accountId: preview.account_id,
      mode,
      ts: r.ts,
    });
    return { ok: true, auditId: auditRow, result: 'sent', failureReason: null, ts: r.ts };
  } catch (e) {
    const reason = e instanceof SlackApiError ? `${e.slackError}: ${e.message}` : String(e);
    const auditRow = await insertAuditRow({
      accountId: preview.account_id,
      mode,
      targetType: preview.target_type,
      targetSlackIdOrChannel: channel,
      messageBody: preview.message_body,
      confirmedBy: input.actor,
      result: 'failed',
      failureReason: reason,
      previewOf: preview.id,
    });
    await audit(input.actor, 'slack.send.failed', {
      previewId: preview.id,
      auditId: auditRow,
      reason,
    });
    return { ok: false, auditId: auditRow, result: 'failed', failureReason: reason };
  }
}

export async function cancelSend(input: ConfirmInput): Promise<{ auditId: string }> {
  const pr = await query<PreviewRow>(
    `SELECT * FROM slack_message_audit WHERE id = $1`,
    [input.previewId],
  );
  const preview = pr.rows[0];
  if (!preview) throw new Error(`Preview ${input.previewId} not found.`);
  const reused = await query<{ id: string }>(
    `SELECT id FROM slack_message_audit WHERE preview_of = $1 LIMIT 1`,
    [input.previewId],
  );
  if (reused.rows[0]) {
    throw new Error(`Preview ${input.previewId} has already been acted on.`);
  }
  const id = await insertAuditRow({
    accountId: preview.account_id,
    mode: preview.target_type === 'self_test' ? 'test_to_self' : 'send',
    targetType: preview.target_type,
    targetSlackIdOrChannel: preview.target_slack_id_or_channel,
    messageBody: preview.message_body,
    confirmedBy: input.actor,
    result: 'cancelled',
    failureReason: null,
    previewOf: preview.id,
  });
  await audit(input.actor, 'slack.send.cancelled', { previewId: preview.id, auditId: id });
  return { auditId: id };
}

async function insertAuditRow(args: {
  accountId: string;
  mode: 'preview' | 'test_to_self' | 'send';
  targetType: 'customer_channel' | 'self_test';
  targetSlackIdOrChannel: string | null;
  messageBody: string;
  confirmedBy: string;
  result: 'previewed' | 'sent' | 'blocked' | 'cancelled' | 'failed';
  failureReason: string | null;
  previewOf: string | null;
}): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO slack_message_audit
       (account_id, mode, target_type, target_slack_id_or_channel,
        message_body, confirmed_by, confirmed_at, result, failure_reason, preview_of)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9) RETURNING id`,
    [
      args.accountId,
      args.mode,
      args.targetType,
      args.targetSlackIdOrChannel,
      args.messageBody,
      args.confirmedBy,
      args.result,
      args.failureReason,
      args.previewOf,
    ],
  );
  return r.rows[0]!.id;
}

export async function listRecentAudits(limit = 50): Promise<{
  id: string;
  accountId: string;
  mode: string;
  targetType: string;
  result: string;
  failureReason: string | null;
  confirmedBy: string | null;
  createdAt: string;
}[]> {
  const r = await query<{
    id: string;
    account_id: string;
    mode: string;
    target_type: string;
    result: string;
    failure_reason: string | null;
    confirmed_by: string | null;
    created_at: string;
  }>(
    `SELECT id, account_id, mode, target_type, result, failure_reason,
            confirmed_by, created_at
       FROM slack_message_audit ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    id: x.id,
    accountId: x.account_id,
    mode: x.mode,
    targetType: x.target_type,
    result: x.result,
    failureReason: x.failure_reason,
    confirmedBy: x.confirmed_by,
    createdAt: x.created_at,
  }));
}

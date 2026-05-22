// Integration-ish tests for the send service:
//   - preview → confirm sends to customer channel when gate is ON
//   - preview → confirm BLOCKS when gate is OFF (records `blocked` audit)
//   - preview test_to_self redirects to the configured DM target
//   - cancel records `cancelled` audit and prevents subsequent confirm
//   - confirm twice on the same preview throws (no re-use of confirmation)
//
// We replace @mdas/db with an in-memory pseudo-table and replace the Slack
// HTTP client with a spy. The send-service code path itself is real.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mocks (must be hoisted via vi.mock) ---

vi.mock('server-only', () => ({}));

interface MappingRow {
  account_id: string;
  account_name: string | null;
  slack_url: string | null;
  slack_channel_id: string | null;
  source: 'salesforce' | 'override' | 'cache';
  status: string;
  status_reason: string | null;
  last_refreshed_at: string;
  last_validated_at: string | null;
  updated_by: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  account_id: string;
  mode: string;
  target_type: string;
  target_slack_id_or_channel: string | null;
  message_body: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  result: string;
  failure_reason: string | null;
  preview_of: string | null;
  created_at: string;
}

const state = {
  mappings: new Map<string, MappingRow>(),
  audits: new Map<string, AuditRow>(),
  auditLog: [] as { actor: string; event: string; details: unknown }[],
  nextId: 1,
};

function uuid(): string {
  return `00000000-0000-0000-0000-${String(state.nextId++).padStart(12, '0')}`;
}

vi.mock('@mdas/db', () => {
  return {
    async query(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim().toUpperCase();

      // ------- mappings -------
      if (s.startsWith('SELECT * FROM CUSTOMER_SLACK_MAPPING WHERE ACCOUNT_ID =')) {
        const row = state.mappings.get(params[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      // ------- slack_message_audit insert preview/confirm -------
      if (s.startsWith('INSERT INTO SLACK_MESSAGE_AUDIT')) {
        const id = uuid();
        // Identify by number of $ params: preview path has 6 ($1..$6), full
        // confirm path has 9. We bind from positional params in order
        // matching the queries in slack-send-service.ts.
        if (params.length === 6) {
          // preview insert (no confirmed_by/at/preview_of)
          const [account_id, mode, target_type, target_slack_id_or_channel, message_body, failure_reason] =
            params as [string, string, string, string | null, string, string | null];
          state.audits.set(id, {
            id,
            account_id,
            mode,
            target_type,
            target_slack_id_or_channel,
            message_body,
            confirmed_by: null,
            confirmed_at: null,
            result: 'previewed',
            failure_reason,
            preview_of: null,
            created_at: new Date().toISOString(),
          });
        } else if (params.length === 9) {
          const [account_id, mode, target_type, target_slack_id_or_channel, message_body, confirmed_by, result, failure_reason, preview_of] =
            params as [string, string, string, string | null, string, string, string, string | null, string | null];
          state.audits.set(id, {
            id,
            account_id,
            mode,
            target_type,
            target_slack_id_or_channel,
            message_body,
            confirmed_by,
            confirmed_at: new Date().toISOString(),
            result,
            failure_reason,
            preview_of,
            created_at: new Date().toISOString(),
          });
        } else {
          throw new Error(`Unhandled insert param count: ${params.length}`);
        }
        return { rows: [{ id }], rowCount: 1 };
      }

      if (s.startsWith('SELECT * FROM SLACK_MESSAGE_AUDIT WHERE ID =')) {
        const row = state.audits.get(params[0] as string);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (s.startsWith('SELECT ID FROM SLACK_MESSAGE_AUDIT WHERE PREVIEW_OF =')) {
        const previewId = params[0] as string;
        const hits = [...state.audits.values()].filter((a) => a.preview_of === previewId);
        return { rows: hits.map((h) => ({ id: h.id })), rowCount: hits.length };
      }

      throw new Error(`Unhandled SQL in mock: ${sql.slice(0, 80)}`);
    },
    async audit(actor: string, event: string, details: unknown) {
      state.auditLog.push({ actor, event, details });
    },
    async latestSuccessfulRun() {
      return null;
    },
  };
});

// Replace the network client; the rest of slack-send is real code.
const postMessageMock = vi.fn();
vi.mock('@mdas/slack-send', async () => {
  const real = await vi.importActual<typeof import('@mdas/slack-send')>('@mdas/slack-send');
  return {
    ...real,
    postMessage: postMessageMock,
  };
});

// --- Helpers ---

function seedMapping(row: Partial<MappingRow> & { account_id: string }): void {
  const now = new Date().toISOString();
  state.mappings.set(row.account_id, {
    account_name: 'Acme Corp',
    slack_url: 'https://zuora.slack.com/archives/C0123ABCD',
    slack_channel_id: 'C0123ABCD',
    source: 'salesforce',
    status: 'mapped',
    status_reason: null,
    last_refreshed_at: now,
    last_validated_at: null,
    updated_by: 'system',
    updated_at: now,
    ...row,
  } as MappingRow);
}

function resetState(): void {
  state.mappings.clear();
  state.audits.clear();
  state.auditLog.length = 0;
  state.nextId = 1;
  postMessageMock.mockReset();
}

// --- Tests ---

describe('slack-send-service', () => {
  beforeEach(() => {
    resetState();
    delete process.env.ENABLE_SLACK_SEND;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_TEST_USER_ID;
  });

  it('preview to customer channel marks send-not-allowed when gate is OFF (default)', async () => {
    seedMapping({ account_id: 'A1' });
    const { previewSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'hello',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    expect(p.targetSlackIdOrChannel).toBe('C0123ABCD');
    expect(p.sendAllowed).toBe(false);
    expect(p.blockedReason).toMatch(/ENABLE_SLACK_SEND/);
  });

  it('confirm with gate OFF records a blocked audit row and does not call Slack', async () => {
    seedMapping({ account_id: 'A1' });
    const { previewSend, confirmSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'hello',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    const r = await confirmSend({ previewId: p.previewId, actor: 'tester' });
    expect(r.ok).toBe(false);
    expect(r.result).toBe('blocked');
    expect(postMessageMock).not.toHaveBeenCalled();
    const auditRow = state.audits.get(r.auditId)!;
    expect(auditRow.result).toBe('blocked');
    expect(auditRow.preview_of).toBe(p.previewId);
  });

  it('confirm with gate ON sends to mapped customer channel exactly once', async () => {
    process.env.ENABLE_SLACK_SEND = 'true';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    postMessageMock.mockResolvedValueOnce({ ok: true, channel: 'C0123ABCD', ts: '123.456' });

    seedMapping({ account_id: 'A1' });
    const { previewSend, confirmSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'hello team',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    expect(p.sendAllowed).toBe(true);
    const r = await confirmSend({ previewId: p.previewId, actor: 'tester' });
    expect(r.ok).toBe(true);
    expect(r.result).toBe('sent');
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith({
      botToken: 'xoxb-test',
      channel: 'C0123ABCD',
      text: 'hello team', // no TEST MODE prefix for customer channel
    });
  });

  it('test_to_self preview targets configured DM and prepends TEST MODE on send', async () => {
    process.env.ENABLE_SLACK_SEND = 'true';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_TEST_USER_ID = 'U999';
    postMessageMock.mockResolvedValueOnce({ ok: true, channel: 'U999', ts: '1.0' });

    seedMapping({ account_id: 'A1' }); // mapping exists; test mode bypasses it
    const { previewSend, confirmSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'draft',
      targetType: 'self_test',
      actor: 'tester',
    });
    expect(p.targetSlackIdOrChannel).toBe('U999');
    expect(p.sendAllowed).toBe(true);

    const r = await confirmSend({ previewId: p.previewId, actor: 'tester' });
    expect(r.ok).toBe(true);
    expect(postMessageMock).toHaveBeenCalledWith({
      botToken: 'xoxb-test',
      channel: 'U999',
      text: '[TEST MODE — redirected from customer channel] draft',
    });
  });

  it('test_to_self preview is blocked when SLACK_TEST_USER_ID missing', async () => {
    process.env.ENABLE_SLACK_SEND = 'true';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    seedMapping({ account_id: 'A1' });
    const { previewSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'x',
      targetType: 'self_test',
      actor: 'tester',
    });
    expect(p.sendAllowed).toBe(false);
    expect(p.blockedReason).toMatch(/SLACK_TEST_USER_ID/);
  });

  it('customer_channel preview is blocked when mapping is missing', async () => {
    const { previewSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A_unknown',
      messageBody: 'x',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    expect(p.sendAllowed).toBe(false);
    expect(p.blockedReason).toMatch(/no-row|mapping/i);
  });

  it('cancel records a cancelled row and blocks subsequent confirm', async () => {
    seedMapping({ account_id: 'A1' });
    const { previewSend, cancelSend, confirmSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'hi',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    const c = await cancelSend({ previewId: p.previewId, actor: 'tester' });
    expect(state.audits.get(c.auditId)?.result).toBe('cancelled');
    await expect(
      confirmSend({ previewId: p.previewId, actor: 'tester' }),
    ).rejects.toThrow(/already been acted on/);
  });

  it('confirm twice on same preview throws (no re-use of confirmation)', async () => {
    process.env.ENABLE_SLACK_SEND = 'true';
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    postMessageMock.mockResolvedValueOnce({ ok: true, channel: 'C0123ABCD', ts: '1' });

    seedMapping({ account_id: 'A1' });
    const { previewSend, confirmSend } = await import('./slack-send-service.js');
    const p = await previewSend({
      accountId: 'A1',
      messageBody: 'once',
      targetType: 'customer_channel',
      actor: 'tester',
    });
    await confirmSend({ previewId: p.previewId, actor: 'tester' });
    await expect(
      confirmSend({ previewId: p.previewId, actor: 'tester' }),
    ).rejects.toThrow(/already been acted on/);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });
});

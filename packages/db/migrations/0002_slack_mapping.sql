-- Slack mapping + send-audit tables for the customer-channel workflow.
--
-- Two tables:
--
--   customer_slack_mapping  — durable per-account mapping record. One row
--     per accountId; refreshed in-place (idempotent UPSERT) by the
--     refresh flow. Holds the resolved Slack URL/channel-id, status, and
--     provenance (salesforce | override | cache). Manual overrides live
--     in the same table with source='override'; refresh preserves them
--     and re-computes status against the (now overridden) URL.
--
--   slack_message_audit     — append-only log of every preview, confirm,
--     send, cancel, block, failure. Never deleted. The send pipeline
--     reads back the matching `previewed` row by id before allowing a
--     `send` to proceed — this is the "no reuse of confirmation across
--     messages" guarantee.
--
-- Note: the existing `audit_log` table also receives high-level events
-- (`slack.mapping.refresh.start`, `slack.send.blocked`, etc.) so the
-- admin/refresh audit feed shows Slack activity alongside refreshes.
-- slack_message_audit is the detailed per-message record.

CREATE TABLE IF NOT EXISTS customer_slack_mapping (
  account_id TEXT PRIMARY KEY,
  account_name TEXT,
  -- Salesforce-derived URL captured at last refresh. NULL when the SFDC
  -- field is empty. Manual overrides set this alongside source='override'.
  slack_url TEXT,
  -- Parsed channel id (Cxxxxx for public/private channels, Gxxxxx for
  -- legacy private groups, Dxxxxx for DMs). NULL when parsing fails.
  slack_channel_id TEXT,
  -- Provenance of slack_url. Resolution order is enforced in code:
  --   override > salesforce > cache (carry-forward from previous refresh)
  source TEXT NOT NULL CHECK (source IN ('salesforce','override','cache')),
  -- Explicit status enum. See packages/slack-send/src/status.ts for
  -- the authoritative list and meaning of each value.
  status TEXT NOT NULL CHECK (status IN (
    'mapped',
    'missing_salesforce_channel',
    'invalid_slack_url',
    'inaccessible_channel',
    'unresolved',
    'manually_overridden'
  )),
  status_reason TEXT,
  notes TEXT,
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Reserved for a future Slack API conversations.info validation pass.
  -- We do NOT auto-validate today (no Slack API calls during refresh) —
  -- this column lets a manual "validate now" action stamp the row.
  last_validated_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_slack_mapping_status_idx
  ON customer_slack_mapping(status);

CREATE TABLE IF NOT EXISTS slack_message_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  -- preview          — render-only, no Slack API call
  -- test_to_self     — sent (or previewed) to the configured test recipient
  -- send             — sent to the customer channel
  mode TEXT NOT NULL CHECK (mode IN ('preview','test_to_self','send')),
  -- Where the message was (or would be) delivered.
  target_type TEXT NOT NULL CHECK (target_type IN ('customer_channel','self_test')),
  -- Resolved channel-id or DM-id, or NULL for a blocked preview that had
  -- no valid target.
  target_slack_id_or_channel TEXT,
  message_body TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  -- previewed   — preview rendered, no send attempted
  -- sent        — Slack API returned ok=true
  -- blocked     — hard toggle off, or mapping invalid for a real send
  -- cancelled   — user cancelled after preview
  -- failed      — Slack API returned ok=false or threw
  result TEXT NOT NULL CHECK (result IN ('previewed','sent','blocked','cancelled','failed')),
  failure_reason TEXT,
  -- The preview audit row's id that a send/confirm refers back to. NULL on
  -- the preview row itself. Enforces "no reuse of confirmation across
  -- messages": the send route requires a matching previewed-row id whose
  -- message_body + target match what the user is about to send.
  preview_of UUID REFERENCES slack_message_audit(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slack_message_audit_account_idx
  ON slack_message_audit(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS slack_message_audit_created_idx
  ON slack_message_audit(created_at DESC);

-- Enforce at-most-once confirm per preview row. Without this, concurrent
-- POST /api/slack/send/confirm requests can both pass the read-check-then-act
-- guard and deliver duplicate customer-facing Slack messages.
CREATE UNIQUE INDEX IF NOT EXISTS slack_message_audit_preview_of_unique
  ON slack_message_audit(preview_of)
  WHERE preview_of IS NOT NULL;

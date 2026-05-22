-- Every mapping row should carry BOTH a channel name AND a URL,
-- regardless of source. Until now we stored only `slack_url` and
-- `slack_channel_id` (id, never the human name). Slack URLs do not
-- contain the channel name — only the id (Cxxx) — so a separate
-- column is required.
--
-- Three new columns:
--
--   channel_name         — human-readable channel name (e.g. "cust-acme").
--                          Always populated when we can derive it:
--                          - From Slack API (real name)        — most accurate
--                          - From cust-{slug} convention       — always available
--                          - Null only when account name is empty
--
--   channel_name_source  — how channel_name was derived:
--                          'slack-api'   resolved via conversations.list
--                          'convention'  derived from account name slug
--
--   is_archived          — true if Slack API reports the channel as
--                          archived. Null when unknown (no API token,
--                          or channel is private and not visible).
--
-- We also relax the source CHECK to keep allowing 'heuristic' for rows
-- that were promoted to mapped status via API name→id resolution
-- (source records HOW we got the URL, not the URL's quality).

ALTER TABLE customer_slack_mapping
  ADD COLUMN IF NOT EXISTS channel_name TEXT,
  ADD COLUMN IF NOT EXISTS channel_name_source TEXT,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN;

-- Backfill: every existing row gets a convention-derived channel name
-- so the UI never shows "no name" on the next render. The refresh
-- pass will overwrite with real Slack names where the API resolves.
UPDATE customer_slack_mapping
   SET channel_name = COALESCE(channel_name, derived_channel_name),
       channel_name_source = COALESCE(channel_name_source,
                                      CASE WHEN derived_channel_name IS NOT NULL
                                           THEN 'convention' END);

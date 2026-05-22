-- Expand the customer_slack_mapping source vocabulary so a row can be
-- explicit about WHERE its URL/candidate came from:
--
--   salesforce  — Internal_Customer_Slack_Channel__c (existing)
--   override    — admin manual override (existing)
--   sheet       — imported from the operational tracker spreadsheet via
--                 the admin paste-in route (new). The codebase forbids
--                 gdrive scraping, so this slot is populated by an
--                 explicit human-driven import, not an auto-fetch.
--   heuristic   — computed `cust-{slugified-account-name}` candidate.
--                 NOTE: heuristic rows do NOT have a real Slack channel
--                 id — Slack URLs require a channel id (Cxxx) and we
--                 cannot manufacture one. Heuristic rows hold the
--                 candidate channel *name* in `derived_channel_name`;
--                 the UI surfaces it as a suggestion for the user to
--                 verify in Slack and (optionally) promote to override.
--   cache       — carry-forward (existing)
--
-- Status enum gets one new value:
--
--   heuristic_candidate — derived from naming convention only; no URL,
--                         no channel id; NOT sendable. The send gate
--                         continues to require a real channel id, so
--                         heuristic rows fail closed for send.

ALTER TABLE customer_slack_mapping
  DROP CONSTRAINT IF EXISTS customer_slack_mapping_source_check;
ALTER TABLE customer_slack_mapping
  ADD CONSTRAINT customer_slack_mapping_source_check
  CHECK (source IN ('salesforce','override','sheet','heuristic','cache'));

ALTER TABLE customer_slack_mapping
  DROP CONSTRAINT IF EXISTS customer_slack_mapping_status_check;
ALTER TABLE customer_slack_mapping
  ADD CONSTRAINT customer_slack_mapping_status_check
  CHECK (status IN (
    'mapped',
    'missing_salesforce_channel',
    'invalid_slack_url',
    'inaccessible_channel',
    'unresolved',
    'manually_overridden',
    'heuristic_candidate'
  ));

ALTER TABLE customer_slack_mapping
  ADD COLUMN IF NOT EXISTS derived_channel_name TEXT;

-- Sheet-imported URLs, keyed by accountId. Small, separate table so the
-- main mapping refresh can read sheet-sourced URLs without churning the
-- mapping row on every reimport. One row per account; the import route
-- UPSERTs and the refresh joins.
--
-- The CSV import path writes rows here; mapping refresh reads them as
-- the `sheet` source slot.
CREATE TABLE IF NOT EXISTS customer_slack_mapping_sheet (
  account_id TEXT PRIMARY KEY,
  account_name TEXT,
  slack_url TEXT NOT NULL,
  imported_by TEXT NOT NULL DEFAULT 'manual:nick',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_note TEXT
);

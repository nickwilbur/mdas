-- MDAS v0 schema. Append-only snapshots + audit log.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS refresh_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  sources_attempted JSONB NOT NULL,
  sources_succeeded JSONB NOT NULL,
  row_counts JSONB,
  error_log JSONB
);

CREATE INDEX IF NOT EXISTS refresh_runs_started_at_idx ON refresh_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS snapshot_account (
  refresh_id UUID NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (refresh_id, account_id)
);

CREATE TABLE IF NOT EXISTS snapshot_opportunity (
  refresh_id UUID NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (refresh_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS snapshot_opp_account_idx ON snapshot_opportunity(refresh_id, account_id);

CREATE TABLE IF NOT EXISTS account_view (
  refresh_id UUID NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  view_payload JSONB NOT NULL,
  PRIMARY KEY (refresh_id, account_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  details JSONB
);

CREATE TABLE IF NOT EXISTS refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued',
  refresh_run_id UUID REFERENCES refresh_runs(id),
  requested_by TEXT NOT NULL DEFAULT 'manual:nick'
);

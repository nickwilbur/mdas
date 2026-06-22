-- Expand 3 account plans — persisted generated artifacts.

CREATE TABLE IF NOT EXISTS account_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  account_name TEXT,
  franchise TEXT NOT NULL DEFAULT 'Expand 3',
  status TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by TEXT,
  generation_mode TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  plan JSONB NOT NULL,
  error_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_plans_account_generated_idx
  ON account_plans (account_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS account_plans_status_idx
  ON account_plans (status)
  WHERE status = 'refreshing';

CREATE TABLE IF NOT EXISTS account_plan_bulk_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT NOT NULL DEFAULT 'manual:nick',
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB
);

CREATE INDEX IF NOT EXISTS account_plan_bulk_jobs_enqueued_idx
  ON account_plan_bulk_jobs (enqueued_at DESC);

CREATE TABLE IF NOT EXISTS account_plan_bulk_job_items (
  job_id UUID NOT NULL REFERENCES account_plan_bulk_jobs(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  plan_id UUID REFERENCES account_plans(id),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (job_id, account_id)
);

CREATE INDEX IF NOT EXISTS account_plan_bulk_job_items_job_status_idx
  ON account_plan_bulk_job_items (job_id, status);

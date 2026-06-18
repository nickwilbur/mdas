-- Memoized per-refresh trajectory KPIs for forecast Health Snapshot.
-- Populated by the worker after each successful refresh so
-- loadForecastTrajectory() reads small JSONB rows instead of full
-- snapshot_account / snapshot_opportunity payloads per calendar day.

ALTER TABLE refresh_runs
  ADD COLUMN IF NOT EXISTS trajectory_kpis jsonb;

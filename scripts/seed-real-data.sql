-- Seed real Expand 3 account data directly into database
-- This bypasses module resolution issues with the seed script

DO $$
DECLARE
  refresh_run_id UUID;
BEGIN
  -- Create a refresh run
  INSERT INTO refresh_runs (scoring_version, sources_attempted, sources_succeeded, started_at, completed_at, status, row_counts)
  VALUES (
    'v0.1.0',
    '["mock"]'::jsonb,
    '["mock"]'::jsonb,
    NOW(),
    NOW(),
    'completed',
    '{"accounts": 12, "opportunities": 12}'::jsonb
  )
  RETURNING id INTO refresh_run_id;
  
  -- Insert real Expand 3 accounts from Glean
  INSERT INTO snapshot_account (refresh_id, account_id, payload, captured_at)
  SELECT 
    refresh_run_id,
    sfid,
    jsonb_build_object(
      'accountId', sfid,
      'salesforceAccountId', sfid,
      'accountName', name,
      'zuoraTenantId', NULL,
      'accountOwner', NULL,
      'assignedCSE', NULL,
      'csCoverage', NULL,
      'franchise', 'Expand 3',
      'cseSentiment', 'Green',
      'cseSentimentCommentary', NULL,
      'cseSentimentLastUpdated', NULL,
      'cseSentimentCommentaryLastUpdated', NULL,
      'cerebroRiskCategory', 'Low',
      'cerebroRiskAnalysis', NULL,
      'cerebroRisks', jsonb_build_object(
        'utilizationRisk', false,
        'engagementRisk', false,
        'suiteRisk', false,
        'shareRisk', false,
        'legacyTechRisk', false,
        'expertiseRisk', false,
        'pricingRisk', false
      ),
      'allTimeARR', 500000,
      'activeProductLines', products,
      'engagementMinutes30d', 0,
      'engagementMinutes90d', 0,
      'isConfirmedChurn', false,
      'churnReason', NULL,
      'churnReasonSummary', NULL,
      'churnDate', NULL,
      'gainsightTasks', '[]'::jsonb,
      'workshops', '[]'::jsonb,
      'recentMeetings', '[]'::jsonb,
      'accountPlanLinks', '[]'::jsonb,
      'sourceLinks', '[]'::jsonb,
      'lastUpdated', NOW()
    ),
    NOW()
  FROM (VALUES 
    ('0017000001TL8uwAAD', 'Adweek, LLC', ARRAY['Zephr']::text[]),
    ('0017000000nsQPHAA2', 'WEHCO Media, Inc', ARRAY['Zephr']::text[]),
    ('0017000000j2jlwAAA', 'Quotit Corporation', ARRAY['Billing']::text[]),
    ('0017000000uJ9uSAAS', 'Teladoc Health, Inc.', ARRAY['RevPro']::text[]),
    ('0017000000YruVLAAZ', 'Acquia, Inc.', ARRAY['Billing']::text[]),
    ('0017000001SDBrqAAH', 'IBM Corporation', ARRAY['Billing']::text[]),
    ('0017000000PnYcNAAV', 'Riverbed Technology', ARRAY['RevPro']::text[]),
    ('0017000000nsQV2AAM', 'Rimini Street, Inc.', ARRAY['RevPro']::text[]),
    ('0017000000koAphAAE', 'Prezi', ARRAY['Billing']::text[]),
    ('00170000018Ip9UAAS', 'Automation Anywhere Inc.', ARRAY['RevPro']::text[]),
    ('0017000000SxbSWAAZ', 'Tobii Dynavox', ARRAY['Billing']::text[]),
    ('0017000000zWBGNAA4', 'GoAnimate, Inc. (Vyond)', ARRAY['Billing']::text[])
  ) AS v(sfid, name, products);
  
  RAISE NOTICE 'Seeded % real Expand 3 accounts with refresh_id %', 12, refresh_run_id;
END $$;

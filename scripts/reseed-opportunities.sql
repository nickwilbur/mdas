-- Reseed opportunities with realistic data:
-- - 0-3 opportunities per account (variable, deterministic by hash)
-- - Salesforce-style 18-char IDs starting with "006"
-- - Close dates spread across -15 to +36 months from today
-- - Various stages and types

DO $$
DECLARE
  new_refresh_id UUID;
  src_refresh_id UUID;
  acc RECORD;
  opp_count INT;
  i INT;
  hash_val INT;
  months_offset INT;
  close_dt DATE;
  stage_idx INT;
  type_idx INT;
  stages TEXT[] := ARRAY['Qualification','Discovery','Proposal','Negotiation','Closed Won','Closed Lost'];
  stage_nums INT[] := ARRAY[2,3,5,6,8,9];
  opp_types TEXT[] := ARRAY['Renewal','New Business','Upsell','Cross-sell'];
  confidences TEXT[] := ARRAY['Low','Medium','High','Confirmed'];
  -- Salesforce ID base32-ish chars (real SF uses A-Z 0-9 plus case)
  sf_chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  sf_id TEXT;
  ch INT;
  acv_val NUMERIC;
  product_line TEXT;
  prod_arr TEXT[];
BEGIN
  -- Find the latest successful refresh with accounts
  SELECT refresh_id INTO src_refresh_id
  FROM snapshot_account
  GROUP BY refresh_id
  HAVING COUNT(*) >= 200
  ORDER BY MAX(captured_at) DESC
  LIMIT 1;

  IF src_refresh_id IS NULL THEN
    RAISE EXCEPTION 'No source refresh with sufficient accounts found';
  END IF;

  -- Create a new refresh run with success status
  INSERT INTO refresh_runs (scoring_version, sources_attempted, sources_succeeded, started_at, completed_at, status, row_counts)
  VALUES (
    'v0.1.0',
    '["mock"]'::jsonb,
    '["mock"]'::jsonb,
    NOW(),
    NOW(),
    'success',
    '{"accounts": 236, "opportunities": 0}'::jsonb
  )
  RETURNING id INTO new_refresh_id;

  -- Copy all accounts from source refresh to new refresh
  INSERT INTO snapshot_account (refresh_id, account_id, payload, captured_at)
  SELECT new_refresh_id, account_id, payload, NOW()
  FROM snapshot_account
  WHERE refresh_id = src_refresh_id;

  -- For each account, generate 0-3 opportunities deterministically based on account_id hash
  FOR acc IN SELECT account_id, payload FROM snapshot_account WHERE refresh_id = new_refresh_id LOOP
    -- Deterministic count: hash account_id, mod 5 -> distribution: 0(20%), 1(20%), 2(20%), 3(20%), 1(20%)
    hash_val := abs(hashtext(acc.account_id));
    opp_count := CASE (hash_val % 10)
      WHEN 0 THEN 0
      WHEN 1 THEN 0
      WHEN 2 THEN 1
      WHEN 3 THEN 1
      WHEN 4 THEN 1
      WHEN 5 THEN 2
      WHEN 6 THEN 2
      WHEN 7 THEN 2
      WHEN 8 THEN 3
      WHEN 9 THEN 3
    END;

    -- Get product lines from account payload
    SELECT array_agg(value::text) INTO prod_arr
    FROM jsonb_array_elements_text(COALESCE(acc.payload->'activeProductLines', '[]'::jsonb)) AS value;

    FOR i IN 1..opp_count LOOP
      -- Generate Salesforce-style 18-char ID starting with "006"
      sf_id := '006';
      FOR ch IN 1..15 LOOP
        sf_id := sf_id || substring(sf_chars FROM 1 + ((abs(hashtext(acc.account_id || i::text || ch::text)) % 62)) FOR 1);
      END LOOP;

      -- Spread close dates from -15 months to +36 months
      months_offset := -15 + ((abs(hashtext(acc.account_id || 'date' || i::text)) % 52));
      close_dt := (CURRENT_DATE + (months_offset || ' months')::interval + ((abs(hashtext(acc.account_id || 'day' || i::text)) % 28) || ' days')::interval)::date;

      -- Pick stage based on whether opp is in past or future
      IF close_dt < CURRENT_DATE THEN
        -- Past: mostly Closed Won, some Closed Lost
        stage_idx := CASE (abs(hashtext(acc.account_id || 'stage' || i::text)) % 5) WHEN 0 THEN 6 ELSE 5 END;
      ELSE
        -- Future: spread across pipeline stages
        stage_idx := 1 + (abs(hashtext(acc.account_id || 'stage' || i::text)) % 4);
      END IF;

      type_idx := 1 + (abs(hashtext(acc.account_id || 'type' || i::text)) % 4);
      acv_val := 50000 + (abs(hashtext(acc.account_id || 'acv' || i::text)) % 950) * 1000;

      product_line := CASE
        WHEN prod_arr IS NULL OR array_length(prod_arr, 1) IS NULL THEN 'Billing'
        ELSE prod_arr[1 + (abs(hashtext(acc.account_id || 'prod' || i::text)) % array_length(prod_arr, 1))]
      END;

      INSERT INTO snapshot_opportunity (refresh_id, opportunity_id, account_id, payload, captured_at)
      VALUES (
        new_refresh_id,
        sf_id,
        acc.account_id,
        jsonb_build_object(
          'opportunityId', sf_id,
          'opportunityName', (acc.payload->>'accountName') || ' - ' || opp_types[type_idx] || ' FY' || EXTRACT(YEAR FROM close_dt),
          'accountId', acc.account_id,
          'type', opp_types[type_idx],
          'stageName', stages[stage_idx],
          'stageNum', stage_nums[stage_idx],
          'closeDate', to_char(close_dt, 'YYYY-MM-DD'),
          'closeQuarter', 'Q' || EXTRACT(QUARTER FROM close_dt),
          'fiscalYear', EXTRACT(YEAR FROM close_dt),
          'acv', acv_val,
          'availableToRenewUSD', acv_val,
          'forecastMostLikely', CASE WHEN stage_idx = 6 THEN 0 ELSE acv_val END,
          'forecastMostLikelyOverride', NULL,
          'mostLikelyConfidence', confidences[1 + (abs(hashtext(acc.account_id || 'conf' || i::text)) % 4)],
          'forecastHedgeUSD', 0,
          'acvDelta', 0,
          'knownChurnUSD', 0,
          'productLine', product_line,
          'flmNotes', '',
          'slmNotes', NULL,
          'scNextSteps', '',
          'salesEngineer', NULL,
          'fullChurnNotificationToOwnerDate', NULL,
          'fullChurnFinalEmailSentDate', NULL,
          'churnDownsellReason', NULL,
          'sourceLinks', jsonb_build_array(
            jsonb_build_object(
              'source', 'salesforce',
              'label', 'SFDC Opportunity',
              'url', 'https://zuora.lightning.force.com/lightning/r/Opportunity/' || sf_id || '/view'
            )
          ),
          'lastUpdated', NOW()
        ),
        NOW()
      );
    END LOOP;
  END LOOP;

  -- Update row_counts
  UPDATE refresh_runs
  SET row_counts = jsonb_build_object(
    'accounts', (SELECT COUNT(*) FROM snapshot_account WHERE refresh_id = new_refresh_id),
    'opportunities', (SELECT COUNT(*) FROM snapshot_opportunity WHERE refresh_id = new_refresh_id)
  )
  WHERE id = new_refresh_id;

  RAISE NOTICE 'Reseeded with refresh_id %; opportunities: %', new_refresh_id,
    (SELECT COUNT(*) FROM snapshot_opportunity WHERE refresh_id = new_refresh_id);
END $$;

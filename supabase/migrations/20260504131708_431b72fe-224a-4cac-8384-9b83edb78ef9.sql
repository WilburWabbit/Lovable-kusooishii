
-- ============================================================
-- Cron + subledger service-role auth cleanup
-- Lovable SQL runner: do NOT use dollar-quoted function bodies.
-- ============================================================

-- 1. Subledger scheduled job helper (idempotent re-create from
--    20260503120500_subledger_cron_internal_secret.sql, safe to apply now).
CREATE OR REPLACE FUNCTION public.invoke_subledger_scheduled_job(
  p_job TEXT,
  p_body JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS '
DECLARE
  v_supabase_url TEXT;
  v_anon_key TEXT;
  v_internal_secret TEXT;
  v_headers JSONB;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret
  INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name IN (''supabase_url'', ''SUPABASE_URL'')
  ORDER BY CASE WHEN name = ''supabase_url'' THEN 0 ELSE 1 END
  LIMIT 1;

  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    v_supabase_url := ''https://gcgrwujfyurgetvqlmbf.supabase.co'';
  END IF;

  SELECT decrypted_secret
  INTO v_anon_key
  FROM vault.decrypted_secrets
  WHERE name IN (''anon_key'', ''SUPABASE_ANON_KEY'')
  ORDER BY CASE WHEN name = ''anon_key'' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT decrypted_secret
  INTO v_internal_secret
  FROM vault.decrypted_secrets
  WHERE name IN (
    ''subledger_scheduled_jobs_secret'',
    ''SUBLEDGER_SCHEDULED_JOBS_SECRET'',
    ''subledger_cron_secret'',
    ''SUBLEDGER_CRON_SECRET''
  )
  ORDER BY CASE
    WHEN name = ''subledger_scheduled_jobs_secret'' THEN 0
    WHEN name = ''SUBLEDGER_SCHEDULED_JOBS_SECRET'' THEN 1
    WHEN name = ''subledger_cron_secret'' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF NULLIF(v_internal_secret, '''') IS NULL THEN
    RAISE EXCEPTION ''Missing internal secret for scheduled subledger job. Store it in vault as subledger_scheduled_jobs_secret.'';
  END IF;

  v_headers := jsonb_build_object(
    ''Content-Type'', ''application/json'',
    ''x-internal-shared-secret'', v_internal_secret
  );

  IF NULLIF(v_anon_key, '''') IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object(
      ''apikey'', v_anon_key,
      ''Authorization'', ''Bearer '' || v_anon_key
    );
  END IF;

  SELECT net.http_post(
    url := rtrim(v_supabase_url, ''/'') || ''/functions/v1/subledger-scheduled-jobs'',
    headers := v_headers,
    body := COALESCE(p_body, ''{}''::jsonb) || jsonb_build_object(''job'', p_job)
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
';

GRANT EXECUTE ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB) TO postgres, service_role;

COMMENT ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB)
IS 'Invokes the subledger-scheduled-jobs Edge Function for pg_cron automation using an internal shared-secret header, without requiring a service-role key in Postgres.';

-- 2. Vault values cron needs to build proper anon-auth + internal-secret headers.
--    These are upserts so re-running the migration is safe.
SELECT vault.create_secret(
  'https://gcgrwujfyurgetvqlmbf.supabase.co',
  'supabase_url',
  'Supabase project URL used by pg_cron HTTP calls'
)
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url');

SELECT vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjZ3J3dWpmeXVyZ2V0dnFsbWJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNjQ4MTQsImV4cCI6MjA4ODY0MDgxNH0.LVDR2Jlu180cXTPcdBN5yVaRuvl7nlgR_8TRW7T6tnk',
  'anon_key',
  'Supabase anon (publishable) key used by pg_cron HTTP calls'
)
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'anon_key');

-- The two internal shared-secret values themselves must be installed by an
-- operator through Lovable Cloud secrets (where they are read by Edge Functions)
-- AND mirrored into Vault under the names below so cron commands can fetch
-- them. The values must match the Edge Function secret values exactly.
-- We do NOT insert the values here because the migration runner has no access
-- to those plaintext values; the operator-provided Vault rows are required.
DO '
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name IN (''internal_cron_secret'', ''INTERNAL_CRON_SECRET'')
  ) THEN
    RAISE NOTICE ''Vault row internal_cron_secret missing. Cron jobs that need it will RAISE on execution. Add it via vault.create_secret(''''<value>'''',''''internal_cron_secret'''').'';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name IN (''subledger_scheduled_jobs_secret'', ''SUBLEDGER_SCHEDULED_JOBS_SECRET'', ''subledger_cron_secret'', ''SUBLEDGER_CRON_SECRET'')
  ) THEN
    RAISE NOTICE ''Vault row subledger_scheduled_jobs_secret missing. invoke_subledger_scheduled_job will RAISE on execution. Add it via vault.create_secret(''''<value>'''',''''subledger_scheduled_jobs_secret'''').'';
  END IF;
END;
';

-- 3. Reschedule every cron job that currently authenticates with a
--    service-role key (Vault-stored or hard-coded JWT) to use anon + internal-secret.
--    We unschedule by name and re-create. Safe because all jobs are pure HTTP
--    triggers; missing one fire is acceptable.

-- Helper SQL fragment used in every job: pulls anon key + internal secret +
-- supabase url from Vault each invocation.

-- 3a. ebay-import-payouts-weekly
SELECT cron.unschedule('ebay-import-payouts-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-import-payouts-weekly');

SELECT cron.schedule(
  'ebay-import-payouts-weekly',
  '0 5 * * 2',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-import-payouts'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := ''{}''::jsonb
  ) AS request_id;
  '
);

-- 3b. ebay-nightly-stock-drift-check (currently has hard-coded JWT — remove it)
SELECT cron.unschedule('ebay-nightly-stock-drift-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-nightly-stock-drift-check');

SELECT cron.schedule(
  'ebay-nightly-stock-drift-check',
  '15 2 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-sync'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := jsonb_build_object(''action'', ''push_stock'', ''source'', ''cron:nightly-drift-check'', ''time'', now())
  ) AS request_id;
  '
);

-- 3c. ebay-retry-order-every-5min
SELECT cron.unschedule('ebay-retry-order-every-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-retry-order-every-5min');

SELECT cron.schedule(
  'ebay-retry-order-every-5min',
  '*/5 * * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/ebay-retry-order'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := jsonb_build_object(''source'', ''cron:ebay-retry-order-every-5min'', ''time'', now())
  ) AS request_id;
  '
);

-- 3d. process-email-queue (verify_jwt = true must remain; this job only enqueues a dispatch trigger).
--     The dispatcher previously used email_queue_service_role_key. Switch to anon + internal-secret.
SELECT cron.unschedule('process-email-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue');

SELECT cron.schedule(
  'process-email-queue',
  '5 seconds',
  '
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/process-email-queue'',
        headers := jsonb_build_object(
          ''Content-Type'', ''application/json'',
          ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
          ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
          ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
        ),
        body := ''{}''::jsonb
      )
    ELSE NULL
  END;
  '
);

-- 3e. qbo-process-pending-safety-net
SELECT cron.unschedule('qbo-process-pending-safety-net')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qbo-process-pending-safety-net');

SELECT cron.schedule(
  'qbo-process-pending-safety-net',
  '* * * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/qbo-process-pending'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1),
      ''x-webhook-trigger'', ''true''
    ),
    body := ''{"batch_size": 50}''::jsonb
  ) AS request_id;
  '
);

-- 3f. rebrickable-daily-incremental
SELECT cron.unschedule('rebrickable-daily-incremental')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rebrickable-daily-incremental');

SELECT cron.schedule(
  'rebrickable-daily-incremental',
  '0 3 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/rebrickable-sync'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := ''{"mode": "incremental"}''::jsonb
  );
  '
);

-- 3g. v2-auto-markdown-prices
SELECT cron.unschedule('v2-auto-markdown-prices')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'v2-auto-markdown-prices');

SELECT cron.schedule(
  'v2-auto-markdown-prices',
  '0 7 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/auto-markdown-prices'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := ''{}''::jsonb
  );
  '
);

-- 3h. v2-auto-progress-orders
SELECT cron.unschedule('v2-auto-progress-orders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'v2-auto-progress-orders');

SELECT cron.schedule(
  'v2-auto-progress-orders',
  '0 6 * * *',
  '
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''supabase_url'' LIMIT 1) || ''/functions/v1/auto-progress-orders'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key'' LIMIT 1),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name IN (''internal_cron_secret'',''INTERNAL_CRON_SECRET'') ORDER BY CASE WHEN name = ''internal_cron_secret'' THEN 0 ELSE 1 END LIMIT 1)
    ),
    body := ''{}''::jsonb
  );
  '
);
